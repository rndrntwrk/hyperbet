import { describe, expect, it } from "bun:test";

import { Sidebar } from "../src/components/Sidebar";
import { click, render } from "./render";

describe("Sidebar", () => {
  it("toggles between expanded and collapsed widths", () => {
    const { container } = render(
      <Sidebar side="left" width={320}>
        <div>Panel body</div>
      </Sidebar>,
    );

    const shell = container.firstElementChild as HTMLElement;
    const toggle = container.querySelector("button") as HTMLButtonElement;

    expect(shell.style.width).toContain("min(320px");
    expect(toggle.textContent).toBe("◀");
    expect(container.textContent).toContain("Panel body");

    click(toggle);

    expect(shell.style.width).toBe("48px");
    expect(toggle.textContent).toBe("▶");
  });
});
