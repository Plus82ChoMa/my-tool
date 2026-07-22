export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, keyword, targetName } = req.query;

  if (!type || !keyword || !targetName) {
    return res.status(400).json({ success: false, error: '검색 키워드와 매장명을 모두 입력해주세요.' });
  }

  // 띄어쓰기, 영문 대소문자, 괄호 전부 무시하고 순수 텍스트만 뭉치는 강력 정규화 함수
  const normalize = (str) => (str || '').replace(/[\s\(\)\[\]\{\}\-\_\.\,]/g, '').toLowerCase();
  const targetNormalized = normalize(targetName);

  try {
    let rank = 101;
    let extractedName = targetName;
    let found = false;
    let scannedList = []; // 🚀 서버가 실제로 읽어들인 상호명들을 순서대로 저장하는 배열 (순위 계산 겸 디버깅용)

    // 📱 네이버 방화벽 우회를 위한 모바일 아이폰 위장 헤더
    const mobileHeader = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json, text/plain, */*'
    };

    if (type === 'store') {
        // [스마트스토어] 네이버 모바일 쇼핑 내부 API 다이렉트 호출 (가장 안정적)
        for (let page = 1; page <= 4; page++) {
            const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel&isKewyordTotalSearch=true`;
            
            const response = await fetch(url, { headers: mobileHeader });
            if (!response.ok) continue;

            const data = await response.json();
            const products = data?.shoppingResult?.products || [];
            
            if (products.length === 0) break;

            for (const item of products) {
                const rawMallName = item.mallName || '';
                if (!rawMallName) continue;

                // 스캔한 스토어명 저장 (저장되는 순간의 배열 길이가 곧 실제 순위!)
                scannedList.push(rawMallName);
                
                const normMallName = normalize(rawMallName);

                // 이름이 겹치는지 확인 (예: '나이키' 입력 시 '나이키 강남본점'도 찾아냄)
                if (normMallName.includes(targetNormalized) || targetNormalized.includes(normMallName)) {
                    rank = scannedList.length; // 배열의 길이가 곧 완벽한 현재 순위!
                    extractedName = rawMallName;
                    found = true;
                    break;
                }
            }
            if (found) break;
            
            // 봇 의심 피하기 위한 안전 대기
            await new Promise(r => setTimeout(r, 300));
        }

    } else {
        // [플레이스] 차단이 심한 지도 API 대신, 가장 방화벽이 허술한 구형 모바일 JSON 통로 사용
        for (let page = 1; page <= 3; page++) {
            let places = [];
            
            // 통로 1: 모바일 지도 구형 API (차단 확률 극히 낮음)
            let url = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(keyword)}&sm=sug&page=${page}&displayCount=50`;
            let response = await fetch(url, { headers: mobileHeader });
            
            try {
                const data = await response.json();
                places = data?.result?.site?.list || data?.result?.place?.list || [];
            } catch(e) {
                // 통로 1 실패 시, 통로 2(신형 PC API)로 우회 시도
                const pcHeader = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://map.naver.com/'
                };
                url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&page=${page}&displayCount=50`;
                response = await fetch(url, { headers: pcHeader });
                try {
                    const data2 = await response.json();
                    places = data2?.result?.place?.list || [];
                } catch(e2) {
                    break; // 둘 다 막히면 루프 종료
                }
            }

            if (places.length === 0) break;

            for (const place of places) {
                const rawPlaceName = place.name;
                scannedList.push(rawPlaceName); // 스캔 기록 저장 (배열 길이 = 순위)

                const normPlaceName = normalize(rawPlaceName);

                if (normPlaceName.includes(targetNormalized) || targetNormalized.includes(normPlaceName)) {
                    rank = scannedList.length; 
                    extractedName = rawPlaceName;
                    found = true;
                    break;
                }
            }
            if (found) break;
            
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // 🚨 [핵심 버그 수정] 리스트를 단 1개도 못 가져왔다면 이건 100위 밖이 아니라 "차단"된 것입니다!
    if (!found && scannedList.length === 0) {
        return res.status(500).json({ success: false, error: '네이버 방화벽이 접근을 100% 차단하여 데이터를 읽지 못했습니다. 잠시 후 시도해주세요.' });
    }

    // 성공 응답 전송 (못 찾았더라도 서버가 긁어온 상위 7개 리스트를 클라이언트로 보냄!)
    return res.status(200).json({ 
        success: true, 
        rank: rank, 
        extractedName: extractedName,
        scannedTop: scannedList.slice(0, 7) // 1위부터 7위까지의 이름 배열
    });

  } catch (error) {
    console.error("Scraping error:", error);
    return res.status(500).json({ success: false, error: '데이터 추출 중 치명적인 서버 오류가 발생했습니다.' });
  }
}
