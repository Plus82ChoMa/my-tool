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
    if (type === 'store') {
      // 1. 스마트스토어 실제 긁어오기 로직
      const url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`;
      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
        }
      });
      const html = await response.text();
      
      // 네이버 쇼핑 데이터 구조 파싱
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
      if (match) {
        const json = JSON.parse(match[1]);
        const items = json?.props?.pageProps?.initialState?.products?.list || [];
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i].item;
          if (!item) continue;
          
          const mallName = (item.mallName || item.maker || '').replace(/\s/g, '').toLowerCase();
          const pName = (item.productTitle || item.productName || '').replace(/\s/g, '').toLowerCase();
          
          // 상호명이나 상품명에 타겟이 포함되어 있으면 순위 확정
          if (mallName.includes(cleanTarget) || pName.includes(cleanTarget)) {
            rank = i + 1;
            break;
          }
        }
      }
    } else {
      // 2. 네이버 플레이스 실제 긁어오기 로직
      const url = `https://map.naver.com/v5/api/search?caller=pc_map&query=${encodeURIComponent(keyword)}&type=all&page=1&displayCount=50`;
      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://map.naver.com/'
        }
      });
      
      if (!response.ok) throw new Error('네이버 지도 API 접근이 거부되었습니다.');
      
      const data = await response.json();
      const items = data?.result?.place?.list || [];
      
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
    return res.status(500).json({ success: false, error: '데이터 수집 실패: ' + error.message });
  }
}