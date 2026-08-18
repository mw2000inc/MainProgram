"use client"

import * as React from "react"
import { notFound } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Droplets } from "lucide-react"
import { AnnouncementPanel } from "@/components/announcements/announcement-panel"
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda"
import { DateControl } from "@/components/dashboard/date-control"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { ResizablePanel } from "@/components/dashboard/resizable-panel"
import { getFilterChangeColumns, getFilterChangeExpandedColumns } from "@/components/filter-change/filter-change-columns"
import { announcementsKey, commentsKey } from "@/lib/hooks/use-announcements"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { AuthContext } from "@/lib/auth/auth-context"
import type {
  Announcement,
  AnnouncementComment,
  ScheduleJob,
  FilterChangePlan,
  User,
} from "@/lib/types"

// DEV-ONLY visual QA route for the Daily Report cards — renders the real panel
// components against seeded react-query cache data and a mocked admin session,
// bypassing real Supabase auth/RLS entirely. Never reachable outside a
// development build (see the NODE_ENV guard below), and not linked from any
// nav — it exists purely so panel-resize/responsive behavior can be screenshot
// and verified without real login credentials.

// Fixed (not live) timestamp — using `new Date()` at module scope would
// produce a different value on the server render vs. the client render a
// moment later, causing a hydration mismatch that has nothing to do with the
// actual panel components being tested.
const now = "2026-08-18T13:31:00.000Z"
const today = now.slice(0, 10)

const MOCK_USER: User = {
  id: "mock-admin-id",
  name: "Mock Admin",
  email: "mock-admin@example.com",
  role: "admin",
  createdAt: now,
}

const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "a1",
    title: "System Maintenance This Weekend — Please Read Before Saturday",
    body: "We will be performing scheduled maintenance on Saturday from 10 PM to 2 AM. Some features may be temporarily unavailable during this window, including the customer portal, QR code scanning, and stock movement recording. Please complete any pending stock adjustments before Friday end of day.",
    createdBy: "mock-admin-id",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "a2",
    title: "New filter stock arrived",
    body: "Restocked filters for SK2 Purple and SK2 Black units.",
    createdBy: "mock-admin-id",
    createdAt: now,
    updatedAt: now,
  },
]

const MOCK_COMMENTS: Record<string, AnnouncementComment[]> = {
  a1: [
    {
      id: "c1",
      announcementId: "a1",
      authorId: "mock-admin-id",
      authorName: "Jerson Capellon",
      body: "Noted, will finish the Makati route adjustments by Friday morning.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  a2: [],
}

const MOCK_SCHEDULE_JOBS: ScheduleJob[] = [
  {
    id: "s1",
    jobType: "installation",
    technician: "Joselito Compereso",
    orderNo: "SK001-0142",
    scheduledDate: today,
    status: "pending",
    createdAt: now,
  },
  {
    id: "s2",
    jobType: "repair",
    technician: "Jerson Capellon",
    orderNo: "SK001-0098",
    scheduledDate: today,
    status: "completed",
    remarks: "Replaced UV lamp and cleaned housing, unit tested and running normally.",
    createdAt: now,
  },
  {
    id: "s3",
    jobType: "filter_change",
    technician: "Jayson Sapitin",
    orderNo: "SK001-0201",
    scheduledDate: today,
    status: "pending",
    createdAt: now,
  },
]

const MOCK_FILTER_CHANGE_PLANS: FilterChangePlan[] = [
  {
    id: "f1",
    orderNumber: "SK001-0142",
    memberAccount: "Golden Harvest Corporation — Manila Branch Office",
    filterType: "012, 013, 019",
    planDate: today,
    status: "Pending",
    contactNumber: "09171234567",
    address: "123 Main St., Quezon City",
    sc: "RO51/RO5",
    productNo: "102 / MW) F5",
    serviceman: "Jayson",
    note: "Customer requested a morning visit before 10 AM",
    createdAt: now,
  },
  {
    id: "f2",
    orderNumber: "SK001-0098",
    memberAccount: "Alex Bernales",
    filterType: "013",
    planDate: today,
    status: "Completed",
    contactNumber: "09088835235",
    address: "#44 Libra St., Brgy Industrial Valley",
    sc: "UF44/UF4",
    productNo: "103 / MW) Hercules",
    serviceman: "Jerson",
    note: "",
    createdAt: now,
  },
  {
    id: "f3",
    orderNumber: "SK001-0201",
    memberAccount: "DEX International Elevator Corp",
    filterType: "012, 013, 021",
    planDate: today,
    status: "Pending",
    contactNumber: "0291261750",
    address: "#1 Kalantiaw St., Brgy. San Antonio",
    sc: "RO057/RO5",
    productNo: "102 / MW) F5",
    serviceman: "Jayson",
    note: "",
    createdAt: now,
  },
]

function MockProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
    })
    qc.setQueryData(announcementsKey, MOCK_ANNOUNCEMENTS)
    for (const a of MOCK_ANNOUNCEMENTS) qc.setQueryData(commentsKey(a.id), MOCK_COMMENTS[a.id] ?? [])
    qc.setQueryData(scheduleJobsKey, MOCK_SCHEDULE_JOBS)
    qc.setQueryData(filterChangePlansKey, MOCK_FILTER_CHANGE_PLANS)
    return qc
  })

  const authValue = React.useMemo(
    () => ({
      user: MOCK_USER,
      loading: false,
      logout: async () => {},
      can: () => true,
      refreshUser: async () => {},
    }),
    []
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  )
}

export default function DailyReportPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound()

  const filterChangeColumns = React.useMemo(() => getFilterChangeColumns(), [])
  const filterChangeExpandedColumns = React.useMemo(() => getFilterChangeExpandedColumns(), [])

  return (
    <MockProviders>
      <div className="min-h-screen bg-background p-4">
        <div className="mx-auto max-w-4xl space-y-6" id="preview-root">
          <div data-testid="panel-announcements">
            <ResizablePanel panelId="announcements" isAdmin savedSize={undefined} onResizeEnd={() => {}}>
              <AnnouncementPanel />
            </ResizablePanel>
          </div>

          <div data-testid="panel-schedule">
            <ResizablePanel panelId="schedule" isAdmin savedSize={undefined} onResizeEnd={() => {}}>
              <ScheduleAgenda date={today} />
            </ResizablePanel>
          </div>

          <div data-testid="panel-date">
            <ResizablePanel panelId="date" isAdmin savedSize={undefined} onResizeEnd={() => {}}>
              <DateControl value={today} onChange={() => {}} />
            </ResizablePanel>
          </div>

          <div data-testid="panel-filter-change">
            <ResizablePanel panelId="filter-change" isAdmin savedSize={undefined} onResizeEnd={() => {}}>
              <DashboardPlanPanel
                title="Filter Change Plan"
                icon={Droplets}
                columns={filterChangeColumns}
                expandedColumns={filterChangeExpandedColumns}
                data={MOCK_FILTER_CHANGE_PLANS}
                loading={false}
                emptyMessage="No filter change plans for this date."
                canAdd
                addLabel="Add"
                onAdd={() => {}}
                canDelete
                onDeleteSelected={async () => {}}
              />
            </ResizablePanel>
          </div>
        </div>
      </div>
    </MockProviders>
  )
}
