import { afterEach } from "bun:test";
import { JSDOM } from "jsdom";

import { cleanupRenderedTrees } from "./render";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

const { window } = dom;

Object.defineProperty(globalThis, "window", {
  value: window,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: window.document,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
Object.defineProperty(globalThis, "HTMLElement", {
  value: window.HTMLElement,
  configurable: true,
});
Object.defineProperty(globalThis, "Event", {
  value: window.Event,
  configurable: true,
});
Object.defineProperty(globalThis, "MouseEvent", {
  value: window.MouseEvent,
  configurable: true,
});
Object.defineProperty(globalThis, "KeyboardEvent", {
  value: window.KeyboardEvent,
  configurable: true,
});
Object.defineProperty(globalThis, "SVGElement", {
  value: window.SVGElement,
  configurable: true,
});
Object.defineProperty(globalThis, "Node", {
  value: window.Node,
  configurable: true,
});
Object.defineProperty(globalThis, "MutationObserver", {
  value: window.MutationObserver,
  configurable: true,
});
Object.defineProperty(globalThis, "getComputedStyle", {
  value: window.getComputedStyle.bind(window),
  configurable: true,
});
Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0),
  configurable: true,
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
  value: (id: number) => clearTimeout(id),
  configurable: true,
});
Object.defineProperty(globalThis, "ResizeObserver", {
  value: class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
  configurable: true,
});

Object.defineProperty(window, "matchMedia", {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  configurable: true,
});

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  value: () => {},
  configurable: true,
});

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
  writable: true,
});

afterEach(() => {
  cleanupRenderedTrees();
  window.document.body.innerHTML = "";
});
