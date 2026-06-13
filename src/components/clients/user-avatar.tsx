import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, colorForId, initials } from "@/lib/utils";

export function UserAvatar({
  user,
  className,
}: {
  user: { id: string; name: string; image?: string | null; color?: string | null } | null | undefined;
  className?: string;
}) {
  if (!user) {
    return (
      <Avatar className={cn("h-7 w-7", className)}>
        <AvatarFallback className="bg-muted text-muted-foreground">—</AvatarFallback>
      </Avatar>
    );
  }
  const bg = user.color ?? colorForId(user.id);
  return (
    <Avatar className={cn("h-7 w-7", className)}>
      {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
      <AvatarFallback style={{ backgroundColor: bg, color: "#fff" }}>
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}
