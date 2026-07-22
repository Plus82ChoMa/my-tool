export default async function handler(req, res) {
  // CORS 처리 (필수)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { type, keyword, link } = req.query;

  if (!type || !keyword || !link) {
    return res.status(400).json({ success: false, error: '검색어와 URL 링크를 모두 입력해주세요.' });
  }

  try {
    let extractedName = '';
    let targetId = '';
    let rank = -1;
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://map.naver.com/',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    };

    if (type === 'store') {
        const match = link.match(/smartstore\.naver\.com\/([^/?]+)/i);
        if (match) {
            targetId = match[1].toLowerCase().trim();
        } else {
            targetId = link.replace(/https?:\/\//, '').split('/')[0].toLowerCase().trim();
        }
        extractedName = targetId; 
        
    } else {
        // 플레이스: 단축 링크(naver.me) 완벽 추적 로직 추가
        let finalLink = link;
        if (finalLink.includes('naver.me')) {
             try {
                // 단축 URL의 최종 목적지 주소를 알아냅니다.
                const redirectRes = await fetch(finalLink, { method: 'GET', redirect: 'follow' });
                finalLink = redirectRes.url;
             } catch(e) {
                console.warn("리다이렉트 추적 실패", e);
             }
        }
        
        // 고유 번호 추출
        const placeIdMatch = finalLink.match(/(?:place|restaurant|hairshop|accommodation|hospital)[^/]*\/([0-9]{6,20})/i) || finalLink.match(/\/([0-9]{6,20})(?:\?|\/|$)/);
        
        if (placeIdMatch) {
            targetId = placeIdMatch[1];
        } else {
            return res.status(400).json({ success: false, error: '플레이스 링크에서 고유 ID를 찾을 수 없습니다. 정확한 [공유하기] 링크를 입력해주세요.' });
        }
        extractedName = "고유 ID: " + targetId; 
    }

    if (type === 'store') {
        let currentRank = 1;
        let found = false;
        
        // Vercel 10초 타임아웃 방지를 위해 최대 3페이지(120위)까지만 탐색
        for (let page = 1; page <= 3; page++) {
            const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel&isKewyordTotalSearch=true`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) break; 
            const data = await response.json();
            
            const products = data?.shoppingResult?.products || data?.items || [];
            if (products.length === 0) break;
            
            for (const item of products) {
                const mallUrl = (item.mallProductUrl || item.mallUrl || '').toLowerCase();
                const mallId = (item.mallId || '').toLowerCase();
                const channelId = (item.channelId || '').toLowerCase();
                
                if (mallUrl.includes(targetId) || mallId === targetId || channelId === targetId) {
                    rank = currentRank;
                    extractedName = item.mallName || targetId;
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break; 
        }
        
    } else {
        let currentRank = 1;
        let found = false;
        
        // 플레이스는 최대 3페이지(150위) 탐색
        for (let page = 1; page <= 3; page++) {
            const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&page=${page}&displayCount=50`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) break; 
            const data = await response.json();
            
            const places = data?.result?.place?.list || [];
            if (places.length === 0) break;
            
            for (const place of places) {
                if (String(place.id) === String(targetId)) {
                    rank = currentRank;
                    extractedName = place.name; 
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break; 
        }
    }

    if (rank === -1) {
        rank = 101; 
    }

    return res.status(200).json({ success: true, rank: rank, extractedName: extractedName });

  } catch (error) {
    console.error("Scrape API Error:", error);
    // 500 에러 대신 200 반환 후 success: false를 주어 프론트엔드에서 예쁘게 에러를 처리하게 유도
    return res.status(200).json({ 
        success: false, 
        error: '서버에서 실시간 데이터를 가져오는 중 네이버 보안 정책에 의해 일시적으로 차단되었습니다. 잠시 후 다시 시도해주세요.' 
    });
  }
}
