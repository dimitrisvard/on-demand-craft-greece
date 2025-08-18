
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import { Link } from "react-router-dom"

export function BackToDashboardButton() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/dashboard">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to Dashboard
      </Link>
    </Button>
  )
}
