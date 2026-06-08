/**
 * core/sentiment/types.ts — Sentiment analysis types.
 */
export type EmotionLabel = 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust';

export interface SentimentResult {
  positive: number;
  negative: number;
  label: 'positive' | 'negative' | 'neutral';
  confidence: number;
  emoji: string;
  emotions: Record<EmotionLabel, number>;
  topEmotions: EmotionLabel[];
}
