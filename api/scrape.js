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
    // 💡 핵심: 네이버 방화벽 우회를 위한 헤더 위장 (가장 최신 브라우저인 척)
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Referer': 'https://map.naver.com/'
    };

    if (type === 'store') {
      // 스마트스토어 로직
      const url = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`;
      const response = await fetch(url, { headers });
      const text = await response.text();
      
      const match = text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
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
      // 💡 플레이스 로직: 구형 API 대신 방화벽이 약한 최신 V5 통합 API 사용
      const url = `https://map.naver.com/v5/api/search?caller=pc_web&query=${encodeURIComponent(keyword)}&type=all&page=1&displayCount=50&isPlaceRecommendationReplace=true&lang=ko`;
      const response = await fetch(url, { headers });
      const text = await response.text();
      
      // 방화벽에 막혀서 JSON 데이터가 아니라 에러 웹페이지(HTML '<')가 날아온 경우 방어
      if (text.trim().startsWith('<')) {
        throw new Error('현재 네이버 방어벽(WAF)이 일시적으로 강력합니다. 1분 뒤 다시 시도해주세요.');
      }
      
      const data = JSON.parse(text);
      // V5 API 구조에 맞게 리스트 추출
      const items = data?.result?.place?.list || data?.result?.site?.list || [];
      
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
    // 뻗지 않고 깔끔한 에러 메시지로 반환
    return res.status(500).json({ success: false, error: error.message });
  }
}
