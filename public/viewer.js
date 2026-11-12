// Показ PDF на странице проверяющего: страницы рисуются картинками (pdf.js),
// поэтому одинаково видно на телефоне и компьютере, а ссылки внутри PDF не кликаются.
import * as pdfjs from "/static/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/static/pdfjs/pdf.worker.min.mjs";

const main = document.getElementById("doc");
const status = document.getElementById("status");

async function render() {
  const pdf = await pdfjs.getDocument({
    url: main.dataset.src,
    cMapUrl: "/static/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/static/pdfjs/standard_fonts/",
    isEvalSupported: false,
  }).promise;
  status.remove();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssWidth = Math.min(main.clientWidth || window.innerWidth, 1000);
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // не больше ~12 млн точек на страницу — иначе iPhone не нарисует canvas
    const scale = Math.min((cssWidth * dpr) / base.width, Math.sqrt(12e6 / (base.width * base.height)));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.aspectRatio = `${base.width} / ${base.height}`;
    main.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }
}

render().catch(() => {
  status.textContent = "Не удалось открыть документ / Could not open the document";
});
