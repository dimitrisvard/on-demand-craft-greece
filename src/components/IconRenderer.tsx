
import React from 'react';
import { 
  Settings, 
  Layers, 
  Clock, 
  CheckCircle, 
  Factory, 
  Wrench, 
  Package, 
  Upload, 
  ShoppingCart, 
  Truck,
  LucideProps 
} from 'lucide-react';

interface IconRendererProps extends LucideProps {
  name: string;
}

const IconRenderer: React.FC<IconRendererProps> = ({ name, ...props }) => {
  switch (name) {
    case 'Settings':
      return <Settings {...props} />;
    case 'Layers':
      return <Layers {...props} />;
    case 'Clock':
      return <Clock {...props} />;
    case 'CheckCircle':
      return <CheckCircle {...props} />;
    case 'Factory':
      return <Factory {...props} />;
    case 'Wrench':
      return <Wrench {...props} />;
    case 'Package':
      return <Package {...props} />;
    case 'Upload':
      return <Upload {...props} />;
    case 'ShoppingCart':
      return <ShoppingCart {...props} />;
    case 'Truck':
      return <Truck {...props} />;
    default:
      return <Settings {...props} />; // Default fallback
  }
};

export default IconRenderer;
