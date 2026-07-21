export default async function handler(req, res) {
  const { type, keyword, name } = req.query;

  if (!type || !keyword || !name) {
    return res.status(400).json({ success: false, error: '검색어와 타겟명을 모두 입력해주세요.' });
  }

  // 대표님께서 발급해주신 네이버 공식 오픈 API 출입증
  const CLIENT_ID = 'z7oub05gYP7vKjDToj2q';
  const CLIENT_SECRET = 'w_ZaZ6NtGS';

  const cleanTarget = name.replace(/\s/g, '').toLowerCase();
  let rank = -1;

  try {
    let url = '';
    if (type === 'store') {
      // 네이버 공식 쇼핑 검색 API
      url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=50`;
    } else {
      // 네이버 공식 지역(플레이스) 검색 API
      url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(keyword)}&display=5`;
    }

    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.errorMessage || '네이버 API 호출에 실패했습니다.');
    }

    const items = data.items || [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = (item.title || item.mallName || '').replace(/<[^>]*>?/gm, '').replace(/\s/g, '').toLowerCase();

      if (title.includes(cleanTarget)) {
        rank = i + 1;
        break;
      }
    }

    // 상위 50위 이내에 일치하는 이름이 없으면 51위로 처리
    if (rank === -1) {
      rank = 51;
    }

    return res.status(200).json({ success: true, rank: rank });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
