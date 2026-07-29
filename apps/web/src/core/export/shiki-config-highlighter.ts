import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import ini from 'shiki/langs/ini.mjs'
import json from 'shiki/langs/json.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import type { ConfigSyntaxLanguage } from './config-syntax'

const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [json, yaml, ini],
  engine: createJavaScriptRegexEngine(),
})

export async function highlightConfig(
  content: string,
  language: ConfigSyntaxLanguage,
): Promise<string> {
  return (await highlighter).codeToHtml(content, {
    lang: language,
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
  })
}
