import { } from 'dotenv/config.js';

import MagowareClient from './src/lib/magoware-client.js';

const imageUrl =
  'https://image.tmdb.org/t/p/w1280/zwtOfT2hUs9TjqOnqj40JyJ71Ke.jpg';


const client = new MagowareClient({
  url: process.env.MAGOWARE_URL,
  user: process.env.MAGOWARE_USER,
  password: process.env.MAGOWARE_PASS
});

(async () => {
  await client.authorize();
  await client.uploadImage(imageUrl);
})()

