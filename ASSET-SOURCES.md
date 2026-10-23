# Asset sources

All imagery is stored locally in `public/images`. Images are illustrative editorial artwork for the demo; their filenames describe the site card using them and do not imply the depicted hardware or people are products or employees of a named company.

## Images

Images were downloaded from Unsplash as JPEGs at quality 85, with maximum width 1000 px (1600 px for Earth). No screenshot crops or generated images are used.

- `earth.jpg`: Earth horizon and city lights. [Original image](https://images.unsplash.com/photo-1451187580459-43490279c0fa). 1600 × 1065.
- `chip.jpg`: Circuit board and microchips. [Original image](https://images.unsplash.com/photo-1518770660439-4636190af475). 1000 × 667.
- `openai.jpg`: Dark Fusion chrome sculpture by Luke Hales. [Unsplash source page](https://unsplash.com/photos/abstract-chrome-sculpture-on-black-background-vmvlYqgURY4), [original image](https://images.unsplash.com/photo-1777646346045-df4bd1114148). 1000 × 650. This is neutral abstract artwork, not the OpenAI logo.
- `apple.jpg`: Apple logo on silver MacBook lid by Mitchel Willem Jacob Anneveldt. [Unsplash source page](https://unsplash.com/photos/bXALaUvuuHU), [original image](https://images.unsplash.com/photo-1630660012196-d199829cf142). 1000 × 1500.
- `multimodal.jpg`: Reflective dark blue metal artwork by Pawel Czerwinski. [Unsplash source page](https://unsplash.com/photos/a-shiny-metal-object-with-a-black-background-KOlJcVU0JW0), [original image](https://images.unsplash.com/photo-1730327442005-b5d3d854eb49). 1000 × 1500.
- `network.jpg`: Abstract flowing blue waves. [Original image](https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4). 1000 × 1333.
- `server.jpg`: Network server cabinets. [Original image](https://images.unsplash.com/photo-1558494949-ef010cbdcc31). 1000 × 561.
- `agent.jpg`: Person working at computer, photographed by Jose Gil. [Unsplash source page](https://unsplash.com/photos/man-in-blue-shirt-using-computer-i79-MmY8FMI), [original image](https://images.unsplash.com/photo-1624718666169-674e3779c524). 1000 × 667.

[Unsplash License](https://unsplash.com/license). Photo copyrights remain with their respective creators. Apple and OpenAI names and trademarks belong to their respective owners.

## Font

`public/fonts/PretendardVariable.woff2` is Pretendard Variable v1.3.9 by Kil Hyung-jin. [Official repository](https://github.com/orioncactus/pretendard), [download source](https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2).

The font is licensed under SIL Open Font License 1.1. The original license is preserved at `public/fonts/OFL.txt`.


## Generated news category artwork

This section adds final generated WebP artwork. The earlier Images section describes the existing JPEG collection. These new assets are neutral category illustrations, not photographs of a company, product, person, or news event. They were generated once with the built-in `image_gen` tool, using one independent call per asset; no CLI/API key, local GPU, or third-party paid service was used. Only resizing and WebP re-encoding were applied afterward. No SVG placeholders are used for this collection.

All files below are stored in `public/images/news-fallbacks/`, at **1200 × 675**. Full generation prompts, source PNG filenames, conversion settings and exact byte sizes are recorded in [`docs/news-image-prompts.json`](docs/news-image-prompts.json). The original PNGs remain outside the public site; their private local paths are kept only in the ignored generation ledger.

| File | Category | Bytes |
| --- | --- | ---: |
| [technology-01.webp](public/images/news-fallbacks/technology-01.webp) | technology | 102336 |
| [technology-02.webp](public/images/news-fallbacks/technology-02.webp) | technology | 39932 |
| [technology-03.webp](public/images/news-fallbacks/technology-03.webp) | technology | 61294 |
| [product-01.webp](public/images/news-fallbacks/product-01.webp) | product | 22076 |
| [product-02.webp](public/images/news-fallbacks/product-02.webp) | product | 24726 |
| [product-03.webp](public/images/news-fallbacks/product-03.webp) | product | 25740 |
| [business-01.webp](public/images/news-fallbacks/business-01.webp) | business | 35648 |
| [business-02.webp](public/images/news-fallbacks/business-02.webp) | business | 30778 |
| [business-03.webp](public/images/news-fallbacks/business-03.webp) | business | 27366 |
| [market-01.webp](public/images/news-fallbacks/market-01.webp) | market | 54578 |
| [market-02.webp](public/images/news-fallbacks/market-02.webp) | market | 53986 |
| [market-03.webp](public/images/news-fallbacks/market-03.webp) | market | 40170 |
| [policy-01.webp](public/images/news-fallbacks/policy-01.webp) | policy | 41288 |
| [policy-02.webp](public/images/news-fallbacks/policy-02.webp) | policy | 42224 |
| [policy-03.webp](public/images/news-fallbacks/policy-03.webp) | policy | 35578 |
| [security-01.webp](public/images/news-fallbacks/security-01.webp) | security | 44662 |
| [security-02.webp](public/images/news-fallbacks/security-02.webp) | security | 18468 |
| [security-03.webp](public/images/news-fallbacks/security-03.webp) | security | 30250 |
| [other-01.webp](public/images/news-fallbacks/other-01.webp) | other | 42790 |
| [other-02.webp](public/images/news-fallbacks/other-02.webp) | other | 46624 |
| [other-03.webp](public/images/news-fallbacks/other-03.webp) | other | 25648 |
| [default.webp](public/images/news-fallbacks/default.webp) | default | 25650 |

Usage and permission policy: [`docs/news-images.md`](docs/news-images.md). Total optimized size: 871812 bytes.
