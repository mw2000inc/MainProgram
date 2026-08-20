"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Users, Package, Search } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useProducts } from "@/lib/hooks/use-inventory"
import { NAV_ITEMS } from "@/components/layout/nav-items"
import { useAuth } from "@/lib/auth/auth-context"

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { user } = useAuth()

  const { data: customers = [] } = useCustomers()
  const { data: products = [] } = useProducts()

  const pages = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "admin")

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-full max-w-sm justify-start text-muted-foreground gap-2 px-3 hidden sm:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="text-sm">Search everything...</span>
        <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded border">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="h-4 w-4" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Global Search" description="Search pages, members, products">
        <CommandInput placeholder="Search pages, members, products..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {pages.map((item) => (
              <CommandItem key={item.href} value={`page ${item.label}`} onSelect={() => go(item.href)}>
                <item.icon className="text-primary" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Member">
            {customers.slice(0, 30).map((c) => (
              <CommandItem key={c.id} value={`member ${c.fullName} ${c.contractNumber} ${c.companyName ?? ""}`} onSelect={() => go(`/customers/${c.id}`)}>
                <Users className="text-secondary" />
                <span>{c.companyName || c.fullName}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.contractNumber}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Products">
            {products.slice(0, 30).map((p) => (
              <CommandItem key={p.id} value={`product ${p.name} ${p.sku}`} onSelect={() => go(`/inventory`)}>
                <Package className="text-success" />
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.sku}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
