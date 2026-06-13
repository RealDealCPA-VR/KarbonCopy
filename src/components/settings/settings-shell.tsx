"use client";

import * as React from "react";
import { FolderCog, FileCog, Users, Zap, Building } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WatchedFoldersTab } from "./watched-folders-tab";
import { FileRulesTab } from "./file-rules-tab";
import { UsersTab } from "./users-tab";
import { AutomatorsTab } from "./automators-tab";
import { FirmTab } from "./firm-tab";
import type {
  Automator,
  FileRule,
  User,
  WatchedRoot,
} from "@/db/schema";

type UserRow = Pick<User, "id" | "name" | "email" | "role" | "active" | "weeklyCapacityMinutes">;

export function SettingsShell(props: {
  roots: WatchedRoot[];
  rules: FileRule[];
  ruleCounts: Record<string, number>;
  users: UserRow[];
  automators: Automator[];
  currentUserId: string;
  firmName: string;
  supportEmail: string;
}) {
  const tabs = [
    { value: "folders", label: "Watched Folders", Icon: FolderCog },
    { value: "rules", label: "File Rules", Icon: FileCog },
    { value: "users", label: "Users & Roles", Icon: Users },
    { value: "automators", label: "Automators", Icon: Zap },
    { value: "firm", label: "Firm", Icon: Building },
  ];

  return (
    <Tabs defaultValue="folders" className="space-y-4">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
            <t.Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="folders">
        <WatchedFoldersTab roots={props.roots} ruleCounts={props.ruleCounts} />
      </TabsContent>
      <TabsContent value="rules">
        <FileRulesTab
          roots={props.roots}
          rules={props.rules}
          users={props.users.map((u) => ({ id: u.id, name: u.name }))}
        />
      </TabsContent>
      <TabsContent value="users">
        <UsersTab users={props.users} currentUserId={props.currentUserId} />
      </TabsContent>
      <TabsContent value="automators">
        <AutomatorsTab automators={props.automators} />
      </TabsContent>
      <TabsContent value="firm">
        <FirmTab firmName={props.firmName} supportEmail={props.supportEmail} />
      </TabsContent>
    </Tabs>
  );
}
