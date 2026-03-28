import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Banknote, Clock, Wallet, Search, FileText } from 'lucide-react';

interface BalanceRecord {
  orderId: string;
  orderTotal: string;
  status: string;
  balance: string;
}

interface TransactionRecord {
  date: string;
  type: 'Invoice' | 'Credit Note' | 'Payout' | 'Prepayment';
  reference: string;
  amount: string;
  status: string;
}

const typeBadgeVariants: Record<TransactionRecord['type'], string> = {
  Invoice: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  'Credit Note': 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  Payout: 'bg-green-100 text-green-800 hover:bg-green-100',
  Prepayment: 'bg-purple-100 text-purple-800 hover:bg-purple-100',
};

const PartnerFinancePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);

  // Placeholder data - ready for integration
  const balanceRecords: BalanceRecord[] = [];
  const transactionRecords: TransactionRecord[] = [];

  const summaryCards = [
    {
      title: 'Prepayments',
      value: '€0.00',
      icon: Banknote,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Not Paid Yet',
      value: '€0.00',
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      title: 'Balance',
      value: '€0.00',
      icon: Wallet,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Partner Finance</h1>
        <p className="text-muted-foreground">
          Track your earnings, invoices, and payment history.
        </p>
      </div>

      {/* Summary Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.title}>
            <CardContent className="flex items-center gap-4 p-6">
              <div className={`rounded-lg p-3 ${card.bgColor}`}>
                <card.icon className={`h-6 w-6 ${card.color}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="balance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="balance">Balance</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        {/* Balance Tab */}
        <TabsContent value="balance" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by PO or invoice number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant={showDateFilter ? 'default' : 'outline'}
              onClick={() => setShowDateFilter(!showDateFilter)}
              className="shrink-0"
            >
              <Clock className="h-4 w-4 mr-2" />
              Date Filter
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Order Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balanceRecords.length > 0 ? (
                  balanceRecords.map((record) => (
                    <TableRow key={record.orderId}>
                      <TableCell className="font-medium">{record.orderId}</TableCell>
                      <TableCell>{record.orderTotal}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{record.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{record.balance}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-48">
                      <div className="flex flex-col items-center justify-center text-center">
                        <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p className="text-muted-foreground">
                          No financial records yet. Complete your first job to see your balance.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionRecords.length > 0 ? (
                  transactionRecords.map((record, index) => (
                    <TableRow key={index}>
                      <TableCell>{record.date}</TableCell>
                      <TableCell>
                        <Badge className={typeBadgeVariants[record.type]}>
                          {record.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{record.reference}</TableCell>
                      <TableCell>{record.amount}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{record.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48">
                      <div className="flex flex-col items-center justify-center text-center">
                        <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p className="text-muted-foreground">No transactions yet.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PartnerFinancePage;
