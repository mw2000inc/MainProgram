"use client"

import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Logo } from "@/components/shared/logo"
import { PaymentStatusBadge } from "@/components/shared/status-badge"
import { useSale } from "@/lib/hooks/use-sales"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useUsers } from "@/lib/hooks/use-misc"
import { useSettings } from "@/lib/hooks/use-misc"
import { formatCurrency, formatDate } from "@/lib/utils"

export default function InvoicePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data: sale, isPending: p1 } = useSale(params.id)
  const { data: customers = [], isPending: p2 } = useCustomers()
  const { data: products = [], isPending: p3 } = useProducts()
  const { data: users = [], isPending: p4 } = useUsers()
  const { data: settings, isPending: p5 } = useSettings()

  const isPending = p1 || p2 || p3 || p4 || p5

  if (isPending) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    )
  }

  if (!sale) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <p className="text-lg font-medium">Invoice not found</p>
        <Button variant="outline" onClick={() => router.push("/sales")}>
          Back to Sales
        </Button>
      </div>
    )
  }

  const customer = customers.find((c) => c.id === sale.customerId)
  const rep = users.find((u) => u.id === sale.salesRepId)
  const gross =
    sale.items.reduce((s, it) => s + it.subtotal, 0) + sale.services.reduce((s, sv) => s + sv.subtotal, 0)
  const shipping = sale.shipping ?? 0
  // Compute the total from the displayed lines so the invoice's own math always
  // adds up (Gross - Discount + Shipping); equals the stored total_amount for
  // correctly-recorded sales.
  const total = gross - sale.discount + shipping

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push("/sales")}>
          <ArrowLeft className="h-4 w-4" /> Back to Sales
        </Button>
        <Button className="gap-1.5" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print Invoice
        </Button>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="p-8 space-y-8">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Logo className="h-10 w-10 shrink-0" />
              <div>
                <p className="font-semibold">{settings?.companyName}</p>
                <p className="text-xs text-muted-foreground">{settings?.supportEmail}</p>
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-semibold">INVOICE</h1>
              <p className="text-sm text-muted-foreground">{sale.invoiceNumber}</p>
              <p className="text-xs text-muted-foreground">{formatDate(sale.date)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Bill To</p>
              <p className="font-medium">{customer?.fullName}</p>
              {customer?.companyName && <p>{customer.companyName}</p>}
              <p className="text-muted-foreground">{customer?.address}</p>
              <p className="text-muted-foreground">{customer?.email}</p>
              <p className="text-muted-foreground">{customer?.contactNumber}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">Sales Representative</p>
              <p className="font-medium">{rep?.name}</p>
              <p className="text-xs text-muted-foreground mt-2 mb-1">Payment Status</p>
              <PaymentStatusBadge status={sale.paymentStatus} />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Product</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item) => {
                const product = products.find((p) => p.id === item.productId)
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2">{product?.name ?? "Unknown product"}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-2 text-right">{formatCurrency(item.subtotal)}</td>
                  </tr>
                )
              })}
              {sale.services.map((service) => (
                <tr key={service.id} className="border-b last:border-0">
                  <td className="py-2">{service.name}</td>
                  <td className="py-2 text-right">{service.quantity}</td>
                  <td className="py-2 text-right">{formatCurrency(service.unitPrice)}</td>
                  <td className="py-2 text-right">{formatCurrency(service.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gross Amount</span>
                <span>{formatCurrency(gross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span>-{formatCurrency(sale.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span>+{formatCurrency(shipping)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base border-t pt-1 mt-1">
                <span>Total Amount</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-2">
                <span>Payment Method</span>
                <span>{sale.paymentMethod}</span>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground border-t pt-4">
            Thank you for choosing {settings?.companyName}!
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
