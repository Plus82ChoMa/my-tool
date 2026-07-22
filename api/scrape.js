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
    
    // 네이버 차단 방지 및 PC/모바일 통합 환경 위장 헤더
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Referer': 'https://map.naver.com/'
    };

    if (type === 'store') {
        // 스마트스토어 & 브랜드스토어 완벽 호환
        const storeMatch = link.match(/(?:smartstore|brand)\.naver\.com\/([^/?]+)/i);
        if (storeMatch) {
            targetId = storeMatch[1].toLowerCase().trim();
        } else {
            targetId = link.replace(/https?:\/\//, '').split('/')[0].toLowerCase().trim();
        }
        extractedName = "스토어 ID: " + targetId; 
        
    } else {
        let finalLink = link;
        // 단축 URL (naver.me) 리다이렉트 추적
        if (finalLink.includes('naver.me')) {
             try {
                const redirectRes = await fetch(finalLink, { method: 'GET', redirect: 'follow' });
                finalLink = redirectRes.url;
                
                // 메타 태그(JS)로 리다이렉트 되는 경우까지 2중 추적
                const text = await redirectRes.text();
                const metaMatch = text.match(/URL=['"]?([^'"]+)['"]?/i);
                if (metaMatch) finalLink = metaMatch[1];
             } catch(e) {
                 console.warn("리다이렉트 실패, 원본 링크로 시도");
             }
        }
        
        finalLink = decodeURIComponent(finalLink);
        
        // 어떤 형태의 네이버 플레이스 링크가 들어와도 무조건 '고유 숫자 ID' 추출
        const exactMatch = finalLink.match(/(?:place|restaurant|hairshop|accommodation|hospital|p\/entry\/place|v5\/entry\/place|pcmap)[^/]*\/([0-9]{6,15})/i);
        
        if (exactMatch) {
            targetId = exactMatch[1];
        } else {
            // 최후의 보루: 링크 내에서 6~15자리의 연속된 숫자 덩어리 찾기
            const numberMatch = finalLink.match(/([0-9]{6,15})/);
            if (numberMatch) targetId = numberMatch[1];
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: '링크에서 매장 고유 ID 번호를 찾을 수 없습니다. 정확한 [공유하기] 링크인지 확인해주세요.' });
        }
        extractedName = "ID: " + targetId + " (상호명 탐색중)"; 
    }

    let found = false;

    if (type === 'store') {
        let currentRank = 1;
        // 최대 5페이지 (200위) 탐색
        for (let page = 1; page <= 5; page++) {
            const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) break; 
            
            const data = await response.json();
            const products = data?.shoppingResult?.products || data?.items || [];
            if (products.length === 0) break;
            
            for (const item of products) {
                const mallUrl = (item.mallProductUrl || item.mallUrl || '').toLowerCase();
                const mallId = (item.mallId || '').toLowerCase();
                const channelId = (item.channelId || '').toLowerCase();
                
                // URL, Mall ID, Channel ID 3중 검사
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
        // 최대 4페이지 (200위) 탐색. searchCoord(GPS) 좌표를 비워서 '가장 객관적인 전국 단위 순위'를 가져옴
        for (let page = 1; page <= 4; page++) {
            const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&searchCoord=&page=${page}&displayCount=50`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) break; 
            const text = await response.text();
            
            // 네이버 캡차(봇 방지) 페이지가 떴을 경우 명확한 에러 반환
            if(text.includes('captcha') || text.includes('기계적인 접근')) {
                return res.status(500).json({ success: false, error: '네이버 방화벽에 의해 스캔이 차단되었습니다. 5분 후 다시 시도해주세요.' });
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch(e) { break; } // JSON 파싱 실패시 루프 종료
            
            const places = data?.result?.place?.list;
            // 해당 키워드에 플레이스 결과가 더 없으면 중단
            if (!places) break;
            
            for (const place of places) {
                // 정확도 100% 매칭: String 변환 후 고유 ID 번호 직접 대조
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

    return res.status(200).json({ 
        success: true, 
        rank: rank, 
        extractedName: extractedName,
        debugId: targetId // 프론트엔드에서 디버깅용으로 띄워주기 위해 ID 반환
    });

  } catch (error) {
    return res.status(500).json({ 
        success: false, 
        error: '서버 에러가 발생했습니다. 잠시 후 다시 시도해주세요.' 
    });
  }
}
