/**
 * applyGlobalFont — installs Space Grotesk as the app-wide default for every
 * `<Text>` / `<TextInput>` without editing call sites.
 *
 * It wraps the components' render so that, when a node does not declare its own
 * `fontFamily`, we inject the Space Grotesk family matching that node's
 * `fontWeight`. Anything that already sets `fontFamily` is left untouched.
 *
 * Call once, before the first render (module side-effect import in the root layout).
 */
import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import { familyForWeight } from './typography';

type Renderable = { render?: (...args: any[]) => any };

function patch(Component: Renderable) {
  if (!Component || typeof Component.render !== 'function') return;
  // Guard against double-patching (Fast Refresh / repeated imports).
  if ((Component.render as any).__spaceGroteskPatched) return;

  const original = Component.render;
  const patched = function (this: unknown, ...args: any[]) {
    const element = original.apply(this, args);
    if (!element || !React.isValidElement(element)) return element;

    const flat = StyleSheet.flatten((element.props as any).style) || {};
    if (flat.fontFamily) return element; // explicit family wins

    const fontFamily = familyForWeight(flat.fontWeight);
    return React.cloneElement(element as React.ReactElement<any>, {
      style: [{ fontFamily }, (element.props as any).style],
    });
  };
  (patched as any).__spaceGroteskPatched = true;
  Component.render = patched;
}

let applied = false;
export function applyGlobalFont() {
  if (applied) return;
  applied = true;
  patch(Text as unknown as Renderable);
  patch(TextInput as unknown as Renderable);
}
