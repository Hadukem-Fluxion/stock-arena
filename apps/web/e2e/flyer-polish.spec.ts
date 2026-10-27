import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setupV3 } from "./flyer-v3-fixture.js";
import { en } from "../src/copy/en.js";
const capture = process.env.T37_POLISH_CAPTURES === "1",
  directory = resolve("docs/review/t37-follow-up");
for (const host of ["telegram", "discord"] as const)
  for (const [width, height] of [
    [360, 640],
    [390, 844],
    [1440, 900],
  ])
    test(`Flyer polish ${host} ${width}: clear title and exit inside the playfield`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: width!, height: height! });
      const f = await setupV3(page, width === 1440 ? 30 : 3, host, true, "flyer-3b");
      const frame =
          host === "discord"
            ? page.frames().find((fr) => fr !== page.mainFrame())!
            : page.mainFrame(),
        root = f.root;
      try {
        await expect(
          root.getByRole("button", { name: en.flyer.tapPlay, exact: true }),
        ).toBeEnabled();
        await frame.evaluate(() => document.fonts.ready);
        // The canvas behind the upper title contains only sky/clouds, not buildings or badges.
        expect(
          await frame.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>(".flight-world canvas")!,
              title = document.querySelector(".flight-title")!.getBoundingClientRect(),
              bounds = canvas.getBoundingClientRect();
            const x = Math.max(title.left, bounds.left, 0),
              end = Math.min(title.right, bounds.right, innerWidth),
              scaleX = canvas.width / bounds.width,
              scaleY = canvas.height / bounds.height;
            const data = canvas
              .getContext("2d")!
              .getImageData(
                Math.ceil((x - bounds.left) * scaleX),
                Math.ceil((title.top + 2 - bounds.top) * scaleY),
                Math.floor((end - x) * scaleX),
                Math.floor(Math.min(36, title.height * 0.3) * scaleY),
              ).data;
            for (let i = 0; i < data.length; i += 4)
              if (data[i]! < 100 || data[i + 1]! < 165 || data[i + 2]! < 170) return false;
            return true;
          }),
        ).toBe(true);
        if (capture) {
          await mkdir(directory, { recursive: true });
          await page.screenshot({ path: resolve(directory, `start-${host}-${width}.png`) });
        }
        await root.getByRole("button", { name: en.flyer.tapPlay, exact: true }).click();
        await root.locator("canvas").press("Space");
        await frame.evaluate(() => {
          const loop = () => {
            const canvas = document.querySelector<HTMLCanvasElement>(".flight-world canvas");
            if (!canvas || !document.querySelector(".is-playing")) return;
            if (
              Number(canvas.dataset.velocity) > 0 &&
              Number(canvas.dataset.y) + Number(canvas.dataset.velocity) * 3 >
                Number(canvas.dataset.targetCenter) + 10000
            )
              canvas.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }),
              );
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        const exit = root.getByRole("button", { name: en.flyer.exit, exact: true });
        await expect(exit).toBeVisible();
        const button = await exit.boundingBox(),
          canvas = await root.locator("canvas").boundingBox();
        expect(button).not.toBeNull();
        expect(canvas).not.toBeNull();
        expect(button!.x).toBeGreaterThanOrEqual(Math.max(0, canvas!.x));
        expect(button!.x + button!.width).toBeLessThanOrEqual(
          Math.min(width!, canvas!.x + canvas!.width),
        );
        expect(button!.y).toBeGreaterThanOrEqual(canvas!.y);
        expect(button!.width).toBeGreaterThanOrEqual(44);
        await expect
          .poll(async () => Number(await root.locator("canvas").getAttribute("data-pipes")), {
            timeout: 12000,
          })
          .toBeGreaterThanOrEqual(2);
        await page.waitForTimeout(500);
        if (capture)
          await page.screenshot({ path: resolve(directory, `play-${host}-${width}.png`) });
        await exit.click();
        await expect(
          root.getByRole("heading", { name: en.flyer.gameOver.toUpperCase(), exact: true }),
        ).toBeVisible();
        expect(f.finishes()).toBe(1);
        expect(
          await frame.evaluate(
            () =>
              document.documentElement.scrollHeight <= innerHeight &&
              document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await f.close();
      }
    });
