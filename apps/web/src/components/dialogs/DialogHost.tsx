"use client";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { NewDmDialog } from "./NewDmDialog";
import { LlmManager } from "@/components/chat/LlmManager";

/** Mounts every app-level dialog. Render once, near the app root. */
export function DialogHost() {
  return (
    <>
      <CreateWorkspaceDialog />
      <CreateChannelDialog />
      <InviteMemberDialog />
      <NewDmDialog />
      <LlmManager />
    </>
  );
}
