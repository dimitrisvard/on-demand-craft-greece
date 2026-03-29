import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Users, FileText, Factory, PackageCheck, UserCircle } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from '@/contexts/AuthContext'

const menuItems = [
  {
    title: "Customers",
    icon: Users,
    path: "/dashboard/customers",
    description: "Manage customer records"
  },
  {
    title: "Customers Section",
    icon: UserCircle,
    path: "/dashboard/customers-section",
    description: "Manage customer section"
  },
  {
    title: "RFQ & Orders",
    icon: FileText,
    path: "/rfq-management",
    description: "Manage RFQs and orders"
  },
  {
    title: "Production Partners",
    icon: Factory,
    path: "/dashboard/partners",
    description: "Manage production partners"
  }
]

export function DashboardSidebar() {
  const location = useLocation()
  const { user } = useAuth()

  // Only show Orders and Calendar for production partners
  const isProductionPartner = user?.role === 'partner_seller'

  const filteredMenuItems = isProductionPartner
    ? [
        {
          title: "Orders",
          icon: PackageCheck,
          path: "/dashboard/orders",
          description: "Manage production orders"
        },
        {
          title: "Calendar",
          icon: Factory,
          path: "/calendar",
          description: "Production calendar"
        }
      ]
    : menuItems

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.description}
                    isActive={location.pathname === item.path}
                  >
                    <Link to={item.path}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
