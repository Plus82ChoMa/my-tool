export default async function handler(req, res) {
  const { type, keyword, link } = req.query;

  if (!type || !keyword || !link) {
    return res.status(400).json({ success: false, error: '검색어와 URL 링크를 모두 입력해주세요.' });
  }

  // 대표님께서 발급해주신 네이버 공식 오픈 API 출입증 (정상 작동 확인)
  const CLIENT_ID = 'z7oub05gYP7vKjDToj2q';
  const CLIENT_SECRET = 'w_ZaZ6NtGS';
  
  try {
    let extractedName = '';
    let targetStoreId = '';
    
    if (type === 'store') {
        // [완벽 개선] 스마트스토어는 네이버에 무단 접속(스크래핑)할 필요가 전혀 없습니다!
        // 고객이 입력한 링크(예: https://smartstore.naver.com/my-shop)에서 'my-shop' 부분만 쏙 빼냅니다.
        const match = link.match(/smartstore\.naver\.com\/([^/?]+)/i);
        if (match) {
            targetStoreId = match[1].toLowerCase().trim();
        } else {
            // 단축 URL이나 다른 형태일 경우를 대비한 최후의 수단
            targetStoreId = link.replace(/https?:\/\//, '').split('/')[0].toLowerCase().trim();
        }
        extractedName = targetStoreId; // 화면 표시용
        
    } else {
        // [완벽 개선] 플레이스의 경우 싸구려 우회 서버 대신 안정적인 엔터프라이즈급 API(Microlink) 사용
        try {
            const mlUrl = `https://api.microlink.io/?url=${encodeURIComponent(link)}`;
            const mlRes = await fetch(mlUrl);
            const mlData = await mlRes.json();
            
            if (mlData.status === 'success' && mlData.data && mlData.data.title) {
                extractedName = mlData.data.title;
            } else {
                throw new Error('Microlink failed');
            }
        } catch (error) {
            // Microlink가 혹시라도 실패하면, 구글 검색로봇(Googlebot)으로 위장하여 다이렉트 접속 시도 (이중 안전장치)
            const fallbackRes = await fetch(link, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
            });
            const html = await fallbackRes.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
                extractedName = titleMatch[1];
            }
        }

        if (!extractedName) {
            throw new Error('해당 플레이스 링크에서 상호명을 읽을 수 없습니다. 정확한 링크인지 확인해주세요.');
        }

        // 네이버가 제목에 붙여놓은 꼬리표 다 떼고 순수 상호명만 남기기
        extractedName = extractedName.replace(/: 네이버쇼핑 스마트스토어/g, '').replace(/- 네이버 지도/g, '').replace(/네이버 지도/g, '').trim();
    }
    
    // 비교를 위해 공백 제거 및 소문자 변환
    const cleanTargetName = extractedName.replace(/\s/g, '').toLowerCase();
    
    let rank = -1;
    let items = [];

    if (type === 'store') {
      // 1. 스토어 검색 (쇼핑 API - 한 번에 100개까지 긁어오기)
      const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=100`;
      const response = await fetch(url, {
        headers: { 'X-Naver-Client-Id': CLIENT_ID, 'X-Naver-Client-Secret': CLIENT_SECRET }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorMessage || '네이버 쇼핑 API 호출 실패');
      items = data.items || [];
      
      // 스토어 순위 매칭 로직 (스크래핑 없이 아이디로만 비교)
      for (let i = 0; i < items.length; i++) {
        const itemLink = (items[i].link || '').toLowerCase();
        const mallName = (items[i].mallName || '').toLowerCase();
        
        if (itemLink.includes(targetStoreId) || mallName.includes(targetStoreId)) {
          rank = i + 1;
          break;
        }
      }
      
    } else {
      // 2. 플레이스 검색 (지역 API - 5개씩 10번 반복해서 50위까지 긁어오기)
      for (let start = 1; start <= 50; start += 5) {
        const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(keyword)}&display=5&start=${start}`;
        const response = await fetch(url, {
          headers: { 'X-Naver-Client-Id': CLIENT_ID, 'X-Naver-Client-Secret': CLIENT_SECRET }
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
      
      // 플레이스 순위 매칭 로직 (이름에 일부 단어만 겹쳐도 정답 처리)
      for (let i = 0; i < items.length; i++) {
        // 네이버가 주는 데이터에 있는 <b> 태그 같은 HTML 제거 및 공백 제거
        const itemTitle = (items[i].title || '').replace(/<[^>]*>?/gm, '').replace(/\s/g, '').toLowerCase();
        
        if (itemTitle.includes(cleanTargetName) || cleanTargetName.includes(itemTitle)) {
          rank = i + 1;
          break;
        }
      }
    }

    // 못 찾았으면 50위 밖(51)으로 처리
    if (rank === -1) {
      rank = 51;
    }

    return res.status(200).json({ success: true, rank: rank, extractedName: extractedName });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
