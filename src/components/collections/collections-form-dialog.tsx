"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useCreateCollection } from "@/lib/hooks/use-collections"

const schema = z.object({
  orderNo: z.string().min(1, "Order number is required"),
  accountName: z.string().min(1, "Member account is required"),
  amount: z.string().min(1, "Amount is required").refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, "Amount must be zero or more"),
  ct: z.string().optional(),
  collectionDate: z.string().min(1, "Date is required"),
  preD: z.string().optional(),
  accD: z.string().optional(),
  note: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function defaultValues(defaultDate: string): FormValues {
  return {
    orderNo: "",
    accountName: "",
    amount: "0",
    ct: "",
    collectionDate: defaultDate,
    preD: "",
    accD: "",
    note: "",
  }
}

export function CollectionsFormDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
}) {
  const createCollection = useCreateCollection()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate])

  async function onSubmit(values: FormValues) {
    await createCollection.mutateAsync({
      ...values,
      amount: Number(values.amount),
      ct: values.ct ?? "",
      status: "Pending",
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add Collection Plan</DialogTitle>
          <DialogDescription>Schedule a payment collection.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="orderNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Number</FormLabel>
                    <FormControl>
                      <Input placeholder="SK001-0001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member Account#</FormLabel>
                    <FormControl>
                      <Input placeholder="Customer or business name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>C/T</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="collectionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan D</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preD"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pre D</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accD"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Acc D</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Optional notes..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCollection.isPending}>
                {createCollection.isPending ? "Saving..." : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
