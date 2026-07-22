export default async function handler(req, res) {
  // 클라이언트(프론트)에서 보낸 검색어와 "링크"를 가져옵니다.
  const { type, keyword, link } = req.query;

  if (!type || !keyword || !link) {
    return res.status(400).json({ success: false, error: '검색어와 URL 링크를 모두 입력해주세요.' });
  }

  // 대표님께서 발급해주신 네이버 공식 오픈 API 출입증
  const CLIENT_ID = 'z7oub05gYP7vKjDToj2q';
  const CLIENT_SECRET = 'w_ZaZ6NtGS';
  
  try {
    // 1. [핵심 기술!] 입력된 링크(URL)에 접속하여 숨겨진 '진짜 상호명'을 0.1초 만에 추출합니다.
    const linkRes = await fetch(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    if (!linkRes.ok) throw new Error('입력하신 링크에 접속할 수 없습니다. URL을 다시 확인해주세요.');
    
    const html = await linkRes.text();
    let extractedName = '';
    
    // 페이지 소스에서 제목(title) 부분만 족집게처럼 찾아냅니다.
    const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (ogMatch) {
        extractedName = ogMatch[1];
    } else {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) extractedName = titleMatch[1];
    }
    
    if (!extractedName) throw new Error('해당 링크에서 상호명을 자동으로 찾을 수 없습니다.');
    
    // 네이버가 붙여놓은 꼬리표 떼어내고 순수 상호명만 남기기
    extractedName = extractedName.replace(/: 네이버쇼핑 스마트스토어/g, '').replace(/- 네이버 지도/g, '').replace(/네이버 지도/g, '').trim();
    
    // 띄어쓰기 전부 제거, 소문자로 변환하여 비교를 쉽게 만듦
    const cleanTarget = extractedName.replace(/\s/g, '').toLowerCase();
    
    let rank = -1;
    let items = [];

    if (type === 'store') {
      // 쇼핑 검색 (50개 한 번에 가져오기)
      const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=50`;
      const response = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': CLIENT_ID,
          'X-Naver-Client-Secret': CLIENT_SECRET,
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorMessage || '네이버 쇼핑 API 호출 실패');
      items = data.items || [];
    } else {
      // 지역 검색 (5개씩 10번 반복해서 50위까지 긁어오기)
      for (let start = 1; start <= 50; start += 5) {
        const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(keyword)}&display=5&start=${start}`;
        const response = await fetch(url, {
          headers: {
            'X-Naver-Client-Id': CLIENT_ID,
            'X-Naver-Client-Secret': CLIENT_SECRET,
          }
        });
        const data = await response.json();
        
        if (!response.ok) {
           if (start === 1) throw new Error(data.errorMessage || '네이버 지역 API 호출 실패');
           break;
        }
        
        const fetchedItems = data.items || [];
        items = items.concat(fetchedItems);
        if (fetchedItems.length === 0) break;
      }
    }

    // 2. 알아낸 상호명(cleanTarget)과 API 결과 리스트를 대조하여 등수 찾기
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = (item.title || item.mallName || '').replace(/<[^>]*>?/gm, '').replace(/\s/g, '').toLowerCase();

      // 서로 이름이 일부라도 겹치면 정답으로 처리
      if (title.includes(cleanTarget) || cleanTarget.includes(title)) {
        rank = i + 1;
        break;
      }
    }

    // 못 찾았으면 51위로 밖으로 처리
    if (rank === -1) {
      rank = 51;
    }

    return res.status(200).json({ success: true, rank: rank });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
