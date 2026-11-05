/**
 * 回归脚本共用：跳过序章/剧情浮层，然后点击屏幕下钩。
 * 依赖页面 430x900 视口与 `#debug`（window.__af）。
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overlayKind(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.comic, .call, .notice');
    return el ? el.className : null;
  });
}

/** 岛上有「接听」就先接——强制来电会挡住出海，不接永远点不动屏幕 */
async function acceptIslandCall(page) {
  return page.evaluate(() => {
    const y = document.querySelector('.island .is-btn.yes');
    if (!y) return false;
    y.click();
    return true;
  });
}

/** 一路点掉序章漫画 / 来电 / 公告，返回是否已清空 */
export async function skipStory(page, max = 48, cx = 215, cy = 430) {
  for (let i = 0; i < max; i++) {
    if (await acceptIslandCall(page)) {
      await sleep(420);
      continue;
    }
    if (!(await overlayKind(page))) return true;
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pick = ['接听', '继续', '挂断', '已阅']
        .map((t) => btns.find((b) => b.textContent && b.textContent.includes(t)))
        .find(Boolean);
      if (pick) {
        pick.click();
        return true;
      }
      return false;
    });
    if (!clicked) await page.mouse.click(cx, cy);
    await sleep(320);
  }
  return !(await overlayKind(page));
}

/** 在岸边点屏幕下钩，并等到进入 cast/descent */
export async function castOff(page, cx = 215, cy = 540) {
  // 再来一次保险：如果岛上有来电，先接掉再点
  for (let i = 0; i < 6; i++) {
    if (!(await acceptIslandCall(page))) break;
    await sleep(420);
  }
  await page.mouse.click(cx, cy);
  for (let i = 0; i < 40; i++) {
    const ph = await page.evaluate(() => document.querySelector('[data-phase]')?.dataset.phase ?? null);
    if (ph && ph !== 'idle') return ph;
    await sleep(100);
  }
  return 'idle';
}
