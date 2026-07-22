export default async function handler(req, res) {
  // CORS 처리
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, keyword, targetName } = req.query;

  if (!type || !keyword || !targetName) {
    return res.status(400).json({ success: false, error: '검색 키워드와 매장명을 모두 입력해주세요.' });
  }

  try {
    let rank = -1;
    let extractedName = targetName;
    let found = false;

    // 🔥 핵심: 네이버 방화벽 완벽 우회를 위한 '일반 사용자 크롬 브라우저' 완벽 위장 헤더
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': `https://map.naver.com/p/search/${encodeURIComponent(keyword)}`,
        'Origin': 'https://map.naver.com',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };

    // 띄어쓰기, 특수문자 상관없이 매칭하기 위한 정규화 함수
    const normalize = (str) => (str || '').replace(/[\s\(\)\[\]\{\}\-\_]/g, '').toLowerCase();
    const targetNormalized = normalize(targetName);

    if (type === 'store') {
        const storeHeaders = { 
            ...headers, 
            'Referer': `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`, 
            'Origin': 'https://msearch.shopping.naver.com' 
        };

        let currentRank = 1;
        for (let page = 1; page <= 4; page++) { // 4페이지(160위) 까지만 탐색
            const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel`;
            const response = await fetch(url, { headers: storeHeaders });

            if (!response.ok) throw new Error('네이버 방화벽 차단');

            const data = await response.json();
            const products = data?.shoppingResult?.products || data?.items || [];
            if (products.length === 0) break;

            for (const item of products) {
                const mallName = normalize(item.mallName);
                if (mallName.includes(targetNormalized) || targetNormalized.includes(mallName)) {
                    rank = currentRank;
                    extractedName = item.mallName;
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break;
            
            // 너무 빠른 요청으로 인한 IP 차단을 막기 위해 0.3초 대기
            await new Promise(r => setTimeout(r, 300));
        }
        
    } else {
        // 플레이스 파트
        let currentRank = 1;
        for (let page = 1; page <= 3; page++) { // 3페이지(150위) 까지만 탐색
            const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&searchCoord=&page=${page}&displayCount=50`;
            const response = await fetch(url, { headers });

            const text = await response.text();
            
            // 캡차 감지 시 즉시 에러 발생 (과부하 방지)
            if(text.includes('captcha') || text.includes('기계적인 접근')) {
                throw new Error('CAPTCHA_BLOCKED');
            }

            let data;
            try { data = JSON.parse(text); } catch(e) { break; }
            
            const places = data?.result?.place?.list;
            if (!places) break;

            for (const place of places) {
                const placeName = normalize(place.name);
                
                // 입력한 이름이 실제 이름에 포함되어 있거나, 실제 이름이 입력한 이름에 포함되어 있으면 정답 처리
                if (placeName.includes(targetNormalized) || targetNormalized.includes(placeName)) {
                    rank = currentRank;
                    extractedName = place.name; 
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break;
            
            // IP 방어용 대기
            await new Promise(r => setTimeout(r, 300));
        }
    }

    if (rank === -1) {
        rank = 101; 
    }

    return res.status(200).json({ success: true, rank, extractedName });

  } catch (error) {
    let errMsg = '데이터 수집 중 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    if(error.message === 'CAPTCHA_BLOCKED') {
        errMsg = '네이버 트래픽이 많아 일시 지연되었습니다. 검색 키워드를 살짝 바꿔서 시도해주세요.';
    }
    return res.status(500).json({ success: false, error: errMsg });
  }
}
