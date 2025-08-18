
import React, { useState } from "react";
import { format, addDays, eachDayOfInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Order } from "@/types/customer";

type OrderCalendarProps = {
  orders: Order[];
  onOrderClick?: (order: Order) => void;
};

type ViewType = "month" | "week";

export function OrderCalendar({ orders, onOrderClick }: OrderCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>("month");

  // Calculate date ranges based on view
  const dateRange = React.useMemo(() => {
    if (view === "week") {
      return eachDayOfInterval({
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 })
      });
    } else {
      return eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate)
      });
    }
  }, [currentDate, view]);

  // Group orders by date
  const ordersByDate = React.useMemo(() => {
    const result: { [key: string]: Array<Order & { isStart?: boolean; isDelivery?: boolean }> } = {};
    
    orders.forEach(order => {
      // Add start date events
      if (order.start_date) {
        const startDateStr = order.start_date.split('T')[0];
        if (!result[startDateStr]) {
          result[startDateStr] = [];
        }
        result[startDateStr].push({...order, isStart: true});
      }
      
      // Add delivery date events
      if (order.delivery_date) {
        const deliveryDateStr = order.delivery_date.split('T')[0];
        if (!result[deliveryDateStr]) {
          result[deliveryDateStr] = [];
        }
        result[deliveryDateStr].push({...order, isDelivery: true});
      }
    });
    
    return result;
  }, [orders]);

  const handlePrevious = () => {
    setCurrentDate(prevDate => {
      if (view === "month") {
        const prevMonth = new Date(prevDate);
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        return prevMonth;
      } else {
        return addDays(prevDate, -7);
      }
    });
  };

  const handleNext = () => {
    setCurrentDate(prevDate => {
      if (view === "month") {
        const nextMonth = new Date(prevDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth;
      } else {
        return addDays(prevDate, 7);
      }
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex justify-between items-center p-4 border-b">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Order Timeline</h2>
        </div>
        <div className="flex items-center space-x-2">
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "px-3",
              view === "month" && "bg-primary text-primary-foreground"
            )}
            onClick={() => setView("month")}
          >
            Month
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            className={cn(
              "px-3",
              view === "week" && "bg-primary text-primary-foreground"
            )}
            onClick={() => setView("week")}
          >
            Week
          </Button>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">
            {view === "month" 
              ? format(currentDate, "MMMM yyyy") 
              : `${format(dateRange[0], "MMM d")} - ${format(dateRange[dateRange.length - 1], "MMM d, yyyy")}`
            }
          </h3>
          <div className="flex space-x-2">
            <Button variant="outline" size="icon" onClick={handlePrevious}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="custom-calendar-container">
          {/* Header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Body */}
          <div>
            {view === "month" ? (
              // Month view
              <div className="grid grid-cols-7 gap-1">
                {dateRange.map((date, index) => {
                  const dayStr = format(date, "yyyy-MM-dd");
                  const dayOrders = ordersByDate[dayStr] || [];
                  const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                  const isToday = format(new Date(), "yyyy-MM-dd") === dayStr;
                  
                  return (
                    <div
                      key={index}
                      className={cn(
                        "h-24 p-1 border align-top",
                        !isCurrentMonth && "bg-muted/20 text-muted-foreground",
                        isToday && "bg-blue-50"
                      )}
                    >
                      <div className="sticky top-0 z-10 bg-inherit pb-1">
                        <div className={cn(
                          "text-right text-sm w-full",
                          isToday && "font-bold text-primary"
                        )}>
                          {format(date, "d")}
                        </div>
                      </div>
                      <div className="space-y-1 overflow-y-auto max-h-20">
                        {dayOrders.slice(0, 3).map((order, i) => {
                          const isDelivery = order.isDelivery;
                          return (
                            <div
                              key={`${order.id}-${i}`}
                              className={cn(
                                "text-xs p-1 rounded truncate cursor-pointer",
                                isDelivery ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                              )}
                              onClick={() => onOrderClick?.(order)}
                            >
                              {isDelivery ? "✓ " : "➔ "}
                              {order.title}
                            </div>
                          );
                        })}
                        {dayOrders.length > 3 && (
                          <div className="text-xs text-center text-muted-foreground">
                            +{dayOrders.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Week view
              <div className="grid grid-cols-7 gap-1">
                {dateRange.map((date, index) => {
                  const dayStr = format(date, "yyyy-MM-dd");
                  const dayOrders = ordersByDate[dayStr] || [];
                  const isToday = format(new Date(), "yyyy-MM-dd") === dayStr;
                  
                  return (
                    <div
                      key={index}
                      className={cn(
                        "h-96 p-1 border align-top",
                        isToday && "bg-blue-50"
                      )}
                    >
                      <div className="sticky top-0 z-10 bg-inherit pb-1 border-b">
                        <div className={cn(
                          "text-center w-full",
                          isToday && "font-bold text-primary"
                        )}>
                          <div className="text-sm">{format(date, "EEE")}</div>
                          <div className="text-lg">{format(date, "d")}</div>
                        </div>
                      </div>
                      <div className="space-y-2 mt-2 overflow-y-auto max-h-80">
                        {dayOrders.map((order, i) => {
                          const isDelivery = order.isDelivery;
                          return (
                            <div
                              key={`${order.id}-${i}`}
                              className={cn(
                                "text-sm p-2 rounded cursor-pointer",
                                isDelivery ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
                              )}
                              onClick={() => onOrderClick?.(order)}
                            >
                              <div className="font-medium truncate">
                                {isDelivery ? "Delivery: " : "Start: "}
                                {order.title}
                              </div>
                              <div className="text-xs mt-1 truncate">
                                {order.customer_name || "Customer"}
                              </div>
                            </div>
                          );
                        })}
                        {dayOrders.length === 0 && (
                          <div className="text-xs text-center text-muted-foreground py-4">
                            No orders
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
