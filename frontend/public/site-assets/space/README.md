# 天启星页面素材

这些素材使用内置 image_gen 工具，依据用户提供的首页及登录页设计图生成。页面中的标题、模型卡片、输入框和按钮全部由 Vue 组件实现。

最终使用的文件：

- `hero.webp`：首页星球背景。
- `login.webp`：登录页背景。
- `scene-1.webp` 至 `scene-4.webp`：写作、学习、办公、图像创作场景图。

背景保留原始生成文件，项目中的版本经过 WebP 压缩。场景图从生成的四宫格中分别裁出。

## 最终生成提示词

### 登录背景（参考登录页设计图）

Use case: precise-object-edit. Asset type: production website login page background, landscape 16:9 1920x1080. Edit target: attached sci-fi login page design. Remove ALL UI elements: remove the top-left logo and Chinese brand, central title/subtitle and cyan divider, remove the entire rectangular login panel including glowing border, all text fields, buttons and text. Reconstruct the beautiful background seamlessly behind the removed elements: giant blue dark planet centered in the sky, blue galaxy stars, snowy alien mountains, lone cloaked explorer bottom left, futuristic towers on right, glossy circular platform foreground. Match original dramatic cinematic blue-black palette and the composition. The result must be a clean full-bleed illustration with absolutely no text, letters, logos, cards, controls, rectangles or UI. Keep the central area naturally dark for HTML form overlay.

### 首页背景（参考首页设计图）

Use case: precise-object-edit. Asset: production website hero background illustration, wide landscape 1920x960. The attached design is the edit target. Extract and reconstruct ONLY its full-bleed top hero sci-fi landscape: giant luminous blue planet on the RIGHT, thin elliptical blue orbital rings around it, deep navy star-filled galaxy sky, rugged snowy alien mountain silhouettes at the bottom, calm reflective dark lake, tiny cloaked explorer far right. Remove every UI overlay: header/navigation border and logo, all text and titles, all four floating model cards, every button, statistic, and all lower content feature/use-case cards. Extend clean landscape to fill entire image. Preserve dramatic sophisticated cinematic blue and cyan light, photorealistic high-end science-fiction concept art texture. Leave the LEFT HALF mostly dark starry sky as negative space for real HTML headings. Keep bright planet around x=70%, y=42%, mountain horizon y=80%. Absolutely no text, logos, icons, UI panels, borders or rectangles.

### 场景插画（独立生成）

A 2 by 2 contact sheet of four cinematic blue sci-fi website card background illustrations, equal size rectangular quadrants with no gutters. High-end realistic digital art, deep navy and electric blue/cyan palette, consistent with a beautiful alien planet snowy landscape. Top left: futuristic writing desk, glowing holographic document sheets and laptop in dark starry mountain observatory. Top right: a woman studying an open luminous blue book, holographic knowledge connections, snowy mountains and stars beyond. Bottom left: futuristic office, person seen from behind at ultrawide monitors with abstract blue data dashboards, windows overlooking space city. Bottom right: digital artist seen from behind at huge pen display painting a spectacular alien snowy mountain landscape with pink and blue nebula, smaller screens nearby. Compose each quadrant with focal objects on right and lower portions leaving upper left dark space for real HTML headings. Absolutely no text, letters, logos, typography, or UI card frames. Entire image landscape aspect ratio 2:1.
