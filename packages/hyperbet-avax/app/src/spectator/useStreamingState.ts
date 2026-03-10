// Re-export the real implementation directly — stream-ui mode uses the live
// SSE/poll backend just like dev mode. No mock override needed here.
export * from "@hyperbet/ui/spectator/useStreamingState";
