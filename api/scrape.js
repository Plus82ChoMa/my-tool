export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, keyword, targetName } = req.query;

  if (!type || !keyword || !targetName) {
    return res.status(400).json({ success: false, error: '검색 키워드와 매장명을 모두 입력해주세요.' });
  }

  // 띄어쓰기, 괄호 등을 무시하고 텍스트만 뭉쳐서 비교하기 위한 함수
  const normalize = (str) => (str || '').replace(/[\s\(\)\[\]\{\}\-\_]/g, '').toLowerCase();
  const targetNormalized = normalize(targetName);

  try {
    let rank = 101; // 기본값 (순위 밖)
    let extractedName = targetName;
    let found = false;

    if (type === 'store') {
        // 🚀 [스토어 완벽 해결] 차단된 API 대신, 네이버 쇼핑 웹페이지 자체를 긁어오는 SSR 파싱 방식 도입
        let currentRank = 1;
        for (let page = 1; page <= 4; page++) {
            const url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel`;
            
            // 스토어 전용 크롤링 헤더 (HTML 페이지 요청)
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml'
                }
            });

            if (!response.ok) throw new Error('STORE_BLOCKED');
            const html = await response.text();

            // 네이버 쇼핑 HTML 내부에 숨겨진 원본 JSON 데이터 추출 (가장 확실한 방법)
            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (!match) break;

            let data;
            try { data = JSON.parse(match[1]); } catch(e) { break; }

            // 쇼핑 리스트 배열 안전하게 접근
            const products = data?.props?.pageProps?.initialState?.products?.list || [];
            if (products.length === 0) break;

            for (const item of products) {
                // 스마트스토어 상호명 추출 (변수명이 다양할 수 있어 이중 체크)
                const mallName = normalize(item.mallName || (item.mallInfoCache && item.mallInfoCache.name) || '');
                
                if (mallName.includes(targetNormalized) || targetNormalized.includes(mallName)) {
                    rank = currentRank;
                    extractedName = item.mallName || item.mallInfoCache?.name || targetName;
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break;
            
            // IP 차단 방지용 안전 대기시간
            await new Promise(r => setTimeout(r, 400));
        }

    } else {
        // 🚀 [플레이스 완벽 해결] 방화벽을 자극하던 과도한 위장 헤더를 제거하고 '초경량 스탠다드 헤더' 적용
        let currentRank = 1;
        
        // 봇 의심을 피하기 위한 최소한의 깔끔한 헤더
        const cleanHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': `https://map.naver.com/p/search/${encodeURIComponent(keyword)}`
        };

        for (let page = 1; page <= 3; page++) {
            const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&page=${page}&displayCount=50`;
            const response = await fetch(url, { headers: cleanHeaders });

            const text = await response.text();
            
            // 캡차(방화벽) 감지 로직 유지
            if(text.includes('captcha') || text.includes('기계적인 접근') || text.includes('Forbidden')) {
                throw new Error('CAPTCHA_BLOCKED');
            }

            let data;
            try { data = JSON.parse(text); } catch(e) { break; }
            
            const places = data?.result?.place?.list;
            if (!places || places.length === 0) break;

            for (const place of places) {
                const placeName = normalize(place.name);
                if (placeName.includes(targetNormalized) || targetNormalized.includes(placeName)) {
                    rank = currentRank;
                    extractedName = place.name; 
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break;
            
            await new Promise(r => setTimeout(r, 400));
        }
    }

    return res.status(200).json({ success: true, rank, extractedName });

  } catch (error) {
    console.error("Scraping error:", error.message);
    
    let errMsg = '데이터 수집 중 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    if(error.message === 'CAPTCHA_BLOCKED') {
        errMsg = '서버 통신이 네이버에 의해 잠시 차단되었습니다. 약 1분 후 다시 시도해주세요.';
    } else if (error.message === 'STORE_BLOCKED') {
        errMsg = '스마트스토어 서버 접근이 지연되고 있습니다.';
    }
    
    return res.status(500).json({ success: false, error: errMsg });
  }
}
