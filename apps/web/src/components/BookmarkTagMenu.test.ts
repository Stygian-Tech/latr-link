import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BookmarkTagMenu, tagMenuPosition } from "./BookmarkTagMenu";

describe("bookmark tag action menu", () => {
  test("names its single trigger and both actions for assistive technology", () => {
    const markup = renderToStaticMarkup(createElement(BookmarkTagMenu, {
      tag: "Work & Reading",
      onRename() {},
      onDelete() {},
    }));
    expect(markup.match(/<summary/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Actions for tag Work &amp; Reading"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-label="Rename tag Work &amp; Reading"');
    expect(markup).toContain('aria-label="Delete tag Work &amp; Reading"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(2);
  });

  test("places a final-row menu above its trigger instead of below the viewport", () => {
    expect(tagMenuPosition(
      { right: 248, top: 720, bottom: 752 },
      { width: 160, height: 80 },
      { width: 1024, height: 768 }
    )).toEqual({ left: 88, top: 636, maxHeight: 752 });
  });

  test("keeps menus within narrow and short viewports", () => {
    const position = tagMenuPosition(
      { right: 150, top: 10, bottom: 42 },
      { width: 160, height: 80 },
      { width: 320, height: 64 }
    );
    expect(position).toEqual({ left: 8, top: 8, maxHeight: 48 });
  });
});
