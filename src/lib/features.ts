/** 功能开关（单点控制）
 *  ADVANCED = false：面向普通用户的精简版 —— 首页只保留「导入题包 + 我的题库」，
 *  隐藏 PDF 抽取、API Key 配置、写作 AI 判改等一切需要 AI 知识的入口。
 *  需要这些能力时把它改成 true 即可（代码都还在，只是不渲染）。 */
export const ADVANCED = false;
/** 写作 AI 判改单独开放：只解锁判分模型配置、判改流程与评分理由报告，
 *  其余 ADVANCED 内容（PDF 抽取 / JSON 导入 / 演示题 / 导出题包）仍由 ADVANCED 控制。 */
export const WRITING_GRADING = true;
