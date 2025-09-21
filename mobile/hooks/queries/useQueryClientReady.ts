// hooks/useQueryClientReady.ts
import { useQueryClient } from "@tanstack/react-query";

export function useQueryClientReady() {
  const queryClient = useQueryClient();
  return Boolean(queryClient);
}
