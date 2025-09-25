require('dotenv').config();
const line = require('@line/bot-sdk');
const express = require('express');
const axios = require('axios');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// 計算兩個經緯度距離（公尺）
function getDistance(lat1, lon1, lat2, lon2) {
  function rad(x) { return x * Math.PI / 180; }
  const R = 6378137; // 地球半徑
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type === 'message' && event.message.type === 'location') {
    const userLat = event.message.latitude;
    const userLng = event.message.longitude;

    // 1️⃣ 抓取台北市即時停車格 JSON（可換成其他縣市 API）
    const url = 'https://tcgbusfs.blob.core.windows.net/blobyoubike/YouBikeTP.json';
    const response = await axios.get(url);
    const data = response.data.retVal;

    // 2️⃣ 計算距離並取最近 10 個
    let parkingList = Object.values(data).map(p => ({
      name: p.sna || p.sArea || '停車場',
      lat: parseFloat(p.lat || 0),
      lng: parseFloat(p.lng || 0),
      available: p.sbi || 0
    }))
    .map(p => ({...p, distance: getDistance(userLat, userLng, p.lat, p.lng)}))
    .sort((a,b) => a.distance - b.distance)
    .slice(0,10);

    // 3️⃣ 生成 FLEX 卡
    const cards = parkingList.map((p, i) => ({
      type: 'bubble',
      hero: {
        type: 'image',
        url: `https://via.placeholder.com/300x150?text=${encodeURIComponent(p.name)}`,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `${p.name}`, weight: 'bold', size: 'md' },
          { type: 'text', text: `距離: ${Math.round(p.distance)} 公尺`, size: 'sm' },
          { type: 'text', text: `可停車位: ${p.available}`, size: 'sm' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '一鍵導航',
              uri: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
            }
          }
        ]
      }
    }));

    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '附近車位',
      contents: { type: 'carousel', contents: cards }
    });

  } else {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '請傳送你的「位置」訊息，BOT 才能找到附近車位喔～'
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));