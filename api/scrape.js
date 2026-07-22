export default async function handler(req, res) {
  const { type, keyword, link } = req.query;

  if (!type || !keyword || !link) {
    return res.status(400).json({ success: false, error: '검색어와 URL 링크를 모두 입력해주세요.' });
  }

  // 대표님께서 발급해주신 네이버 공식 오픈 API 출입증
  const CLIENT_ID = 'z7oub05gYP7vKjDToj2q';
  const CLIENT_SECRET = 'w_ZaZ6NtGS';
  
  try {
    let extractedName = '';
    
    // [핵심 기술 업데이트] 네이버의 Vercel 차단을 뚫기 위해 '해외 무료 우회 프록시(AllOrigins)'를 거쳐 접속합니다.
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(link)}`;
    const linkRes = await fetch(proxyUrl);
    
    if (!linkRes.ok) throw new Error('입력하신 링크에 접속할 수 없습니다. 우회 서버가 혼잡합니다.');
    
    const proxyData = await linkRes.json();
    const html = proxyData.contents;
    
    if (!html) throw new Error('해당 링크에서 웹페이지 정보를 불러오지 못했습니다.');

    // 페이지 소스(HTML)에서 제목(og:title) 부분만 족집게처럼 찾아냅니다.
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

    // 알아낸 상호명(cleanTarget)과 API 결과 리스트를 대조하여 등수 찾기
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = (item.title || item.mallName || '').replace(/<[^>]*>?/gm, '').replace(/\s/g, '').toLowerCase();
      const itemLink = (item.link || '').toLowerCase();

      // 서로 이름이 일부라도 겹치거나, 스마트스토어 링크 주소가 겹치면 정답으로 처리
      if (title.includes(cleanTarget) || cleanTarget.includes(title) || (type === 'store' && itemLink.includes(cleanTarget))) {
        rank = i + 1;
        break;
      }
    }

    // 못 찾았으면 51위 밖으로 처리
    if (rank === -1) {
      rank = 51;
    }

    return res.status(200).json({ success: true, rank: rank, extractedName: extractedName });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
