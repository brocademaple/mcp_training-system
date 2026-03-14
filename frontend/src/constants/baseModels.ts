/**
 * 支持的预训练底模（文本 + 多模态）
 * 训练时通过 hyperparams.base_model 传给 Python 脚本；多模态底模需配套数据格式与脚本（当前仅文本分类流程可用）。
 */
export interface BaseModelOption {
  id: string;
  label: string;
  category: 'text' | 'multimodal';
  note?: string;
}

export const BASE_MODELS: BaseModelOption[] = [
  // 文本分类（当前流程直接支持）
  { id: 'bert-base-uncased', label: 'BERT (英文, uncased)', category: 'text' },
  { id: 'bert-base-chinese', label: 'BERT (中文)', category: 'text' },
  { id: 'hfl/chinese-bert-wwm-ext', label: 'Chinese BERT-WWM 扩展', category: 'text' },
  { id: 'hfl/chinese-roberta-wwm-ext', label: 'Chinese RoBERTa-WWM 扩展', category: 'text' },
  { id: 'roberta-base', label: 'RoBERTa (英文)', category: 'text' },
  { id: 'albert-base-v2', label: 'ALBERT (英文, base)', category: 'text' },
  { id: 'distilbert-base-uncased', label: 'DistilBERT (英文, 轻量)', category: 'text' },
  // 多模态（需图像+文本数据与专用脚本，当前仅选型预留）
  { id: 'openai/clip-vit-base-patch32', label: 'CLIP ViT-B/32 (图文)', category: 'multimodal', note: '多模态需专用数据与脚本' },
  { id: 'Salesforce/blip-itm-base-coco', label: 'BLIP (图文匹配)', category: 'multimodal', note: '多模态需专用数据与脚本' },
];

export const BASE_MODELS_TEXT = BASE_MODELS.filter((m) => m.category === 'text');
export const BASE_MODELS_MULTIMODAL = BASE_MODELS.filter((m) => m.category === 'multimodal');

export const DEFAULT_BASE_MODEL = 'bert-base-uncased';
