"use client"

import * as React from "react"
import { Menu, LogOut, User as UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarNav } from "@/components/layout/sidebar"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { NotificationsMenu } from "@/components/layout/notifications-menu"
import { CommandPalette } from "@/components/layout/command-palette"
import { InstallAppMenuItem } from "@/components/pwa/install-app-menu-item"
import { useAuth, roleLabel } from "@/lib/auth/auth-context"
import { initials } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export function Topbar() {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 backdrop-blur px-4 sm:px-6 print:hidden">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1 flex justify-start">
        <CommandPalette />
      </div>

      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NotificationsMenu />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-1.5 pr-2.5">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {user ? initials(user.name) : <UserIcon className="h-3.5 w-3.5" />}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-medium">{user?.name}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-1">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground font-normal">{user?.email}</span>
              {user && <Badge variant="outline" className="w-fit mt-1">{roleLabel(user.role)}</Badge>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <InstallAppMenuItem />
            <DropdownMenuItem variant="destructive" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
