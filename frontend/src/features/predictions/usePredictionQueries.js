import { useQuery } from '@tanstack/react-query';
import { fetchLatestPrediction } from './predictionApi';

const REFRESH_INTERVAL_MS = 5000;

export function useLatestPredictionQuery() {
  return useQuery({
    queryKey: ['prediction-latest'],
    queryFn: fetchLatestPrediction,
    refetchInterval: REFRESH_INTERVAL_MS,
  });
}
