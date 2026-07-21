export default async function handler(req, res) {
  const { type, keyword, name } = req.query;

  // 파라미터 확인
  if (!type || !keyword || !name) {
    return res.status(400).json({ success: false, error: '검색어와 타겟명을 모두 입력해주세요.' });
  }

  // 띄어쓰기를 무시하고 검색하기 위해 공백 제거
  const cleanTarget = name.replace(/\s/g, '').toLowerCase();
  let rank = -1;

  try {
    // 💡 핵심: 네이버 방화벽을 뚫기 위해 아이폰(모바일) 사람인 척 위장하는 헤더
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Referer': 'https://m.naver.com/'
    };

    if (type === 'store') {
      // 스마트스토어 실제 긁어오기 (모바일 네이버 쇼핑)
      const url = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`;
      const response = await fetch(url, { headers });
      const html = await response.text();
      
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
      if (match) {
        const json = JSON.parse(match[1]);
        const items = json?.props?.pageProps?.initialState?.products?.list || [];
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i].item;
          if (!item) continue;
          
          const mallName = (item.mallName || item.maker || '').replace(/\s/g, '').toLowerCase();
          const pName = (item.productTitle || item.productName || '').replace(/\s/g, '').toLowerCase();
          
          if (mallName.includes(cleanTarget) || pName.includes(cleanTarget)) {
            rank = i + 1;
            break;
          }
        }
      }
    } else {
      // 플레이스 실제 긁어오기 (PC버전 API가 아닌 방어벽이 약한 모바일 지도 API 사용)
      const url = `https://m.map.naver.com/search2/searchMore.naver?query=${encodeURIComponent(keyword)}&page=1&displayCount=50&type=SITE_1`;
      const response = await fetch(url, { headers });
      
      if (!response.ok) throw new Error('네이버 봇 탐지 시스템이 일시적으로 차단했습니다. 잠시 후 다시 시도해주세요.');
      
      const text = await response.text();
      const data = JSON.parse(text);
      const items = data?.result?.site?.list || [];
      
      for (let i = 0; i < items.length; i++) {
        const pName = (items[i].name || '').replace(/\s/g, '').toLowerCase();
        
        // 매장명에 타겟이 포함되어 있으면 순위 확정
        if (pName.includes(cleanTarget)) {
          rank = i + 1;
          break;
        }
      }
    }

    // 최종 실제 순위 반환
    return res.status(200).json({ success: true, rank: rank });
    
  } catch (error) {
    return res.status(500).json({ success: false, error: '데이터 수집 에러: ' + error.message });
  }
}
