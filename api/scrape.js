export default async function handler(req, res) {
  const { type, keyword, link } = req.query;

  if (!type || !keyword || !link) {
    return res.status(400).json({ success: false, error: '검색어와 URL 링크를 모두 입력해주세요.' });
  }

  try {
    let extractedName = '';
    let targetId = '';
    let rank = -1;
    
    // 네이버 봇 차단 방지를 위한 브라우저 위장(User-Agent) 세팅
    const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    if (type === 'store') {
        // 스마트스토어 ID 완벽 추출 (예: https://smartstore.naver.com/myshop)
        const match = link.match(/smartstore\.naver\.com\/([^/?]+)/i);
        if (match) {
            targetId = match[1].toLowerCase().trim();
        } else {
            // 다른 도메인 형태의 쇼핑몰일 경우를 대비한 최후의 보루
            targetId = link.replace(/https?:\/\//, '').split('/')[0].toLowerCase().trim();
        }
        extractedName = targetId; // 탐색 전 기본 표시용
        
    } else {
        // 플레이스: naver.me 등 단축 URL을 넣었을 때 원문 링크를 추적해서 알아냄 (강력한 기능)
        let finalLink = link;
        if (finalLink.includes('naver.me')) {
             try {
                const redirectRes = await fetch(finalLink, { method: 'GET', redirect: 'follow' });
                finalLink = redirectRes.url;
             } catch(e) {
                // 무시하고 진행
             }
        }
        
        // 플레이스 고유 ID 번호 완벽 추출 (가장 확실한 식별 방법)
        // 예: m.place.naver.com/restaurant/123456789/home -> '123456789' 추출
        const placeIdMatch = finalLink.match(/(?:place|restaurant|hairshop|accommodation|hospital)[^/]*\/([0-9]{6,20})/i) || finalLink.match(/\/([0-9]{6,20})(?:\?|\/|$)/);
        
        if (placeIdMatch) {
            targetId = placeIdMatch[1];
        } else {
            throw new Error('플레이스 링크에서 고유 ID를 찾을 수 없습니다. 정확한 플레이스 링크를 입력해주세요.');
        }
        extractedName = "플레이스 " + targetId; // 순위 탐색 성공 시 실제 상호명으로 덮어씌움
    }

    if (type === 'store') {
        let currentRank = 1;
        let found = false;
        
        // [완벽 개선] 네이버 오픈API 버림 -> 실제 스마트폰 네이버 쇼핑 검색결과 API 사용 (최대 200위 딥스캔)
        for (let page = 1; page <= 5; page++) {
            const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel&isKewyordTotalSearch=true`;
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
            
            if (!res.ok) throw new Error('네이버 쇼핑 실제 랭킹 데이터를 가져오는데 실패했습니다.');
            const data = await res.json();
            
            // 응답 데이터 안전하게 파싱 (구조 변경 대비)
            const products = data?.shoppingResult?.products || data?.items || [];
            if (products.length === 0) break;
            
            for (const item of products) {
                const mallUrl = (item.mallProductUrl || item.mallUrl || '').toLowerCase();
                const mallId = (item.mallId || '').toLowerCase();
                const channelId = (item.channelId || '').toLowerCase();
                
                // 상호명(한글) 비교로 인한 억울한 미스매칭 해결! '고유 ID'가 일치하면 무조건 정답!
                if (mallUrl.includes(targetId) || mallId === targetId || channelId === targetId) {
                    rank = currentRank;
                    extractedName = item.mallName || targetId; // 정확한 스토어명 확보
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break; // 찾으면 즉시 루프 탈출
        }
        
    } else {
        // 플레이스 파트
        let currentRank = 1;
        let found = false;
        
        // [완벽 개선] 가짜 순위가 나오는 지역 오픈API 버림 -> 실제 '네이버 지도앱' 통합검색 API 직결 (최대 150위 탐색)
        for (let page = 1; page <= 3; page++) {
            const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&page=${page}&displayCount=50`;
            const res = await fetch(url, {
                headers: { 
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://map.naver.com/'
                }
            });
            
            if (!res.ok) throw new Error('네이버 지도 실제 랭킹 데이터를 가져오는데 실패했습니다.');
            const data = await res.json();
            
            const places = data?.result?.place?.list || [];
            if (places.length === 0) break;
            
            for (const place of places) {
                // 상호명이 '스타벅스' '스타벅스 강남점' 이렇게 달라서 실패하던 현상을 원천 차단. 
                // 주민등록번호와 같은 Place ID로 정확히 매칭합니다.
                if (String(place.id) === String(targetId)) {
                    rank = currentRank;
                    extractedName = place.name; // 실제 플레이스 상호명 확보 완벽
                    found = true;
                    break;
                }
                currentRank++;
            }
            if (found) break; // 찾으면 즉시 루프 탈출
        }
    }

    // 끝끝내 찾지 못했을 경우 (100~150위 완전 밖)
    if (rank === -1) {
        rank = 101; // 화면에서 순위권 밖으로 예외처리하기 쉽도록 101로 고정
    }

    return res.status(200).json({ success: true, rank: rank, extractedName: extractedName });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: '랭킹 실시간 조회 중 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
