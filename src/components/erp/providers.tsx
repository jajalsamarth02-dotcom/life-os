"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

/**
 * Client-side providers: theme (light/dark), TanStack Query for server state,
 * and the sonner toaster used for all mutation feedback.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {/* reducedMotion="user" makes every framer-motion animation respect the OS setting */}
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster richColors position="top-right" />
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
