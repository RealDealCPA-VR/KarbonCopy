"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DetailTabs({
  counts,
  overview,
  contacts,
  work,
  documents,
  timeline,
  notes,
}: {
  counts: { contacts: number; work: number; documents: number; notes: number };
  overview: React.ReactNode;
  contacts: React.ReactNode;
  work: React.ReactNode;
  documents: React.ReactNode;
  timeline: React.ReactNode;
  notes: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        <TabsTrigger value="overview" className="data-[state=active]:bg-muted">
          Overview
        </TabsTrigger>
        <TabsTrigger value="contacts" className="data-[state=active]:bg-muted">
          Contacts {counts.contacts > 0 && <Count n={counts.contacts} />}
        </TabsTrigger>
        <TabsTrigger value="work" className="data-[state=active]:bg-muted">
          Work {counts.work > 0 && <Count n={counts.work} />}
        </TabsTrigger>
        <TabsTrigger value="documents" className="data-[state=active]:bg-muted">
          Documents {counts.documents > 0 && <Count n={counts.documents} />}
        </TabsTrigger>
        <TabsTrigger value="timeline" className="data-[state=active]:bg-muted">
          Timeline
        </TabsTrigger>
        <TabsTrigger value="notes" className="data-[state=active]:bg-muted">
          Notes {counts.notes > 0 && <Count n={counts.notes} />}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">{overview}</TabsContent>
      <TabsContent value="contacts">{contacts}</TabsContent>
      <TabsContent value="work">{work}</TabsContent>
      <TabsContent value="documents">{documents}</TabsContent>
      <TabsContent value="timeline">{timeline}</TabsContent>
      <TabsContent value="notes">{notes}</TabsContent>
    </Tabs>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}
