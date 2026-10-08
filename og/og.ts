import '../src/fonts';
import '../src/style.css';
import './og.css';
import { initSketch } from '../src/sketch';

// fontovi pre crtanja (rough okviri zavise od veličina), pa signal za screenshot
document.fonts.ready.then(() => {
  initSketch();
  setTimeout(() => document.body.setAttribute('data-ready', ''), 1500);
});
