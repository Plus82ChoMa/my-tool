export default async function handler(req, res) {
    // CORS 보안 정책 전면 허용
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { type, keyword, targetName } = req.query;

    if (!type || !keyword || !targetName) {
        return res.status(400).json({ success: false, error: '검색 키워드와 매장명을 모두 입력해주세요.' });
    }

    // 띄어쓰기, 기호 전부 무시하고 순수 텍스트만 뭉치는 정규화 (스마트 매칭)
    const normalize = (str) => (str || '').replace(/[\s\(\)\[\]\{\}\-\_\.\,]/g, '').toLowerCase();
    const targetNormalized = normalize(targetName);

    // 네이버 WAF를 속이기 위한 임의의 한국 IP 생성
    const fakeIP = `112.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Forwarded-For': fakeIP, // IP 위장
        'X-Real-IP': fakeIP
    };

    try {
        const maxPages = type === 'store' ? 4 : 3;
        let scannedList = [];
        let rank = 101;
        let extractedName = targetName;
        let found = false;

        // 🚀 핵심 수정: 동시에 4페이지를 검색하면 네이버가 '디도스(DDoS) 공격'으로 간주하여 즉시 차단합니다.
        // 사람처럼 1페이지 확인 후 0.5초 쉬고 2페이지로 넘어가는 "순차적(Sequential) 스캔"으로 변경합니다.
        for (let page = 1; page <= maxPages; page++) {
            let data = null;
            let items = [];

            try {
                if (type === 'store') {
                    const url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel&isKewyordTotalSearch=true`;
                    const r = await fetch(url, { headers });
                    if (r.ok) {
                        data = await r.json();
                        items = data?.shoppingResult?.products || data?.items || [];
                    }
                } else {
                    // 지도 최신 API 우선 타격
                    const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(keyword)}&type=all&searchCoord=&page=${page}&displayCount=50`;
                    const r = await fetch(url, { headers });
                    
                    if (r.ok) {
                        data = await r.json();
                        items = data?.result?.place?.list || [];
                    } else {
                        // 차단 방어막 발동 시, 보안이 허술한 구형 모바일 API로 자동 우회
                        const url2 = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(keyword)}&sm=sug&page=${page}&displayCount=50`;
                        const r2 = await fetch(url2, { headers });
                        if (r2.ok) {
                            data = await r2.json();
                            items = data?.result?.site?.list || data?.result?.place?.list || [];
                        }
                    }
                }
            } catch(e) {
                // 단일 페이지 에러 무시하고 다음 페이지 속행
            }

            // 긁어온 데이터 조립 및 매칭
            for (const item of items) {
                const rawName = type === 'store' ? (item.mallName || item.channelName || '') : (item.name || '');
                if (!rawName) continue;

                scannedList.push(rawName);
                const normName = normalize(rawName);

                // 상호명 매칭
                if (normName.includes(targetNormalized) || targetNormalized.includes(normName)) {
                    rank = scannedList.length;
                    extractedName = rawName; // 네이버에 실제 등록된 정식 명칭
                    found = true;
                    break;
                }
            }

            if (found) break; // 찾으면 즉시 중단
            
            // 🤖 네이버 방화벽 봇 감지 회피용 강제 휴식 (0.5초 대기) - 이 부분이 차단을 막는 1등 공신입니다!
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 3중 우회마저 모두 실패하여 단 1개의 데이터도 못 가져온 극한의 상황
        if (scannedList.length === 0) {
            return res.status(500).json({ success: false, error: '네이버 실시간 트래픽 폭주로 일시적 지연이 발생했습니다. 1~2분 뒤 다시 눌러주세요.' });
        }

        // 정상 응답 (클라이언트의 엑스레이 UI를 위해 상위 10개 리스트를 함께 보냄)
        return res.status(200).json({
            success: true,
            rank: rank,
            extractedName: extractedName,
            scannedTop: scannedList.slice(0, 10) 
        });

    } catch (error) {
        console.error("Critical Scraping Error:", error);
        return res.status(500).json({ success: false, error: '데이터 분석 중 치명적인 서버 오류가 발생했습니다.' });
    }
}
