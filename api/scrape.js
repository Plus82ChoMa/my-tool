// 파일 경로: /api/search.js (Vercel Serverless Function)

export default async function handler(req, res) {
  const { keyword, placeName } = req.query;

  // Vercel 환경 변수에 네이버 API 키를 등록해야 합니다.
  const clientId = process.env.NAVER_CLIENT_ID; 
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!keyword || !placeName) {
    return res.status(400).json({ error: '키워드와 업체명을 모두 입력해주세요.' });
  }

  try {
    // 네이버 지역(Local) 검색 API 호출 (최대 50개 검색)
    const response = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(keyword)}&display=50`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.errorMessage || '네이버 API 호출 실패');
    }

    // 결과에서 업체명 찾기 (네이버 API는 검색어 하이라이팅을 위해 <b> 태그를 포함하므로 제거 후 비교)
    const items = data.items || [];
    let rank = -1; // -1은 50위 밖을 의미
    
    for (let i = 0; i < items.length; i++) {
      const cleanTitle = items[i].title.replace(/<[^>]*>?/g, ''); // <b> 등 HTML 태그 제거
      if (cleanTitle.includes(placeName)) {
        rank = i + 1;
        break;
      }
    }

    // 프론트엔드로 결과 전달
    return res.status(200).json({
      keyword,
      placeName,
      rank,
      totalSearched: items.length
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 에러가 발생했습니다.' });
  }
}
