"use client";

import * as React from "react";
import { UserPlus, Loader2, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { initials, colorForId, formatMinutes } from "@/lib/utils";
import type { User, UserRole } from "@/db/schema";
import {
  createUser,
  resetUserPassword,
  updateUser,
} from "@/app/(app)/settings/actions";

const ROLES: UserRole[] = ["owner", "admin", "manager", "staff", "readonly"];

type Row = Pick<User, "id" | "name" | "email" | "role" | "active" | "weeklyCapacityMinutes">;

export function UsersTab({ users: initial, currentUserId }: { users: Row[]; currentUserId: string }) {
  const [users, setUsers] = React.useState(initial);
  const [addOpen, setAddOpen] = React.useState(false);
  const [pwUser, setPwUser] = React.useState<Row | null>(null);

  const patch = async (id: string, p: Partial<Row>) => {
    const prev = users;
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const res = await updateUser(id, p);
    if (!res.ok) {
      setUsers(prev);
      toast.error(res.error);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Users &amp; roles
          </CardTitle>
          <CardDescription>Manage who can access KarbonCopy and what they can do.</CardDescription>
        </div>
        <AddUserDialog
          open={addOpen}
          setOpen={setAddOpen}
          onCreated={(u) => setUsers((prev) => [...prev, u])}
        />
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Capacity / wk</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Password</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback style={{ backgroundColor: colorForId(u.id), color: "#fff" }}>
                          {initials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {u.name}
                          {u.id === currentUserId && (
                            <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={u.role} onValueChange={(v) => patch(u.id, { role: v as UserRole })}>
                      <SelectTrigger className="h-8 w-[130px] capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <CapacityEditor
                      minutes={u.weeklyCapacityMinutes}
                      onSave={(m) => patch(u.id, { weeklyCapacityMinutes: m })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.active}
                      disabled={u.id === currentUserId}
                      onCheckedChange={(v) => patch(u.id, { active: v })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setPwUser(u)}
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Reset
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <ResetPasswordDialog user={pwUser} onClose={() => setPwUser(null)} />
    </Card>
  );
}

function CapacityEditor({ minutes, onSave }: { minutes: number; onSave: (m: number) => void }) {
  const [hours, setHours] = React.useState(String(Math.round(minutes / 60)));
  React.useEffect(() => setHours(String(Math.round(minutes / 60))), [minutes]);
  const commit = () => {
    const h = Math.max(0, Math.min(168, Number(hours) || 0));
    onSave(h * 60);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={168}
        className="h-8 w-16"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="text-xs text-muted-foreground">h ({formatMinutes(minutes)})</span>
    </div>
  );
}

function AddUserDialog({
  open,
  setOpen,
  onCreated,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  onCreated: (u: Row) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("staff");
  const [password, setPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setRole("staff");
    setPassword("");
  };

  const submit = async () => {
    setSaving(true);
    const res = await createUser({ name, email, role, password });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onCreated({
      id: "data" in res && res.data ? res.data.id : Math.random().toString(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      active: true,
      weeklyCapacityMinutes: 2400,
    });
    toast.success("User added");
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Create an account for a team member.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-pw">Temporary password</Label>
            <Input
              id="u-pw"
              type="text"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: Row | null; onClose: () => void }) {
  const [password, setPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => setPassword(""), [user]);

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    const res = await resetUserPassword(user.id, password);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Password reset for ${user.name}`);
    onClose();
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for {user?.name}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="rp-pw">New password</Label>
          <Input
            id="rp-pw"
            type="text"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
