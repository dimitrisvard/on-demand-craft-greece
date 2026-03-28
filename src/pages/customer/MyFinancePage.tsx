import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Receipt, CheckCircle, Clock, CreditCard, FileText, Info } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const summaryCards = [
  {
    title: 'Total Invoiced',
    amount: '€0.00',
    icon: Receipt,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    title: 'Paid',
    amount: '€0.00',
    icon: CheckCircle,
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    title: 'Outstanding',
    amount: '€0.00',
    icon: Clock,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
];

const MyFinancePage = () => {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Finance</h1>
        <p className="text-muted-foreground mt-1">
          Track your invoices and payment history
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`rounded-lg p-3 ${card.bg}`}>
                  <Icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.title}</p>
                  <p className="text-2xl font-semibold">{card.amount}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Invoices</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Issued Date</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead className="text-right">Invoice Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="rounded-full bg-muted p-3 mb-4">
                      <Info className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground mb-4">
                      Your finance information will appear here once you have completed orders.
                    </p>
                    <Button variant="outline" size="sm">
                      Learn More
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Payment Methods</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted p-3 mb-4">
              <CreditCard className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              No payment methods configured. Payment methods will be available when you place your first order.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MyFinancePage;
