import { Button, type ButtonProps } from '@/components/ui/button';

type Props = Omit<ButtonProps, 'variant' | 'children'> & {
  children?: React.ReactNode;
};

/** 与数据分析区统一的「查询」次要按钮（outline）。 */
export function DataQuerySubmitButton({ children = '查询', className, ...props }: Props) {
  return (
    <Button className={className ?? 'shrink-0'} variant="outline" {...props}>
      {children}
    </Button>
  );
}
