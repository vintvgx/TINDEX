// hooks/useQueryClientReady.ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function useQueryClientReady() {
    const queryClient = useQueryClient();
    const [isReady, setIsReady] = useState(false);
    
    useEffect(() => {
        if (queryClient) {
            setIsReady(true);
        }
    }, [queryClient]);
    
    return isReady;
}