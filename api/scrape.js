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

    // 🚀 핵심: 3중 우회 접속 엔진 (하나가 막히면 다음 통로로 자동 우회)
    const fetchPage = async (page) => {
        let url = '';
        if (type === 'store') {
            url = `https://msearch.shopping.naver.com/api/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40&productSet=total&viewType=list&sort=rel&isKewyordTotalSearch=true`;
        } else {
            // 지도 API 중 가장 보안이 허술한 구형 모바일 통로 집중 타격
            url = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(keyword)}&sm=sug&page=${page}&displayCount=50`;
        }

        // 전략 1: 다이렉트 돌파 (2.5초 내 응답 없으면 포기)
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 2500);
            const r = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(id);
            if (r.ok) return await r.json();
        } catch(e) { /* 무시하고 전략 2로 이동 */ }

        // 전략 2: 고속 우회 프록시 (Corsproxy)
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url), {
                headers: { 'User-Agent': headers['User-Agent'] },
                signal: controller.signal
            });
            clearTimeout(id);
            if (r.ok) return await r.json();
        } catch(e) { /* 무시하고 전략 3으로 이동 */ }

        // 전략 3: 안정형 우회 프록시 (Allorigins) - 최후의 보루
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3500);
            const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: controller.signal });
            clearTimeout(id);
            if (r.ok) {
                const data = await r.json();
                return JSON.parse(data.contents);
            }
        } catch(e) {}

        return null; // 3중 방어막이 다 뚫리면 널 반환
    };

    try {
        // 🚀 타임아웃 박살: 1,2,3,4 페이지를 "동시에" 스캔합니다 (Promise.all 병렬 처리)
        // 스토어는 4페이지(160위), 플레이스는 3페이지(150위)까지 탐색
        const pages = type === 'store' ? [1, 2, 3, 4] : [1, 2, 3];
        const results = await Promise.all(pages.map(p => fetchPage(p)));

        let scannedList = [];
        let rank = 101;
        let extractedName = targetName;
        let found = false;

        // 병렬로 긁어온 데이터를 순서대로 조립
        for (let i = 0; i < results.length; i++) {
            const data = results[i];
            if (!data) continue;

            let items = [];
            if (type === 'store') {
                items = data?.shoppingResult?.products || data?.items || [];
            } else {
                items = data?.result?.site?.list || data?.result?.place?.list || [];
            }

            for (const item of items) {
                const rawName = type === 'store' ? (item.mallName || item.channelName || '') : (item.name || '');
                if (!rawName) continue;

                scannedList.push(rawName);
                const normName = normalize(rawName);

                // 상호명 매칭 (둘 중 하나가 상대방을 포함하면 정답 인정)
                if (normName.includes(targetNormalized) || targetNormalized.includes(normName)) {
                    rank = scannedList.length;
                    extractedName = rawName; // 네이버에 실제 등록된 정식 명칭
                    found = true;
                    break;
                }
            }
            if (found) break; // 찾으면 이후 페이지 분석 즉시 중단
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
