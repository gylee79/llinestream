
'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, Image as ImageIcon } from 'lucide-react';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase/hooks';
import { collection, query, where, doc, setDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { deleteHierarchyItem } from '@/lib/actions/delete-hierarchy-item';
import ThumbnailEditorDialog from './thumbnail-editor-dialog';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { sanitize } from '@/lib/utils';


type Item = (Field | Classification | Course) & { type: 'field' | 'classification' | 'course' };

const ItemRow = ({ item, onSelect, selected, onEdit, onDelete, onEditThumbnail }: {
  item: Item;
  onSelect: () => void;
  selected: boolean;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onEditThumbnail: (e: React.MouseEvent) => void;
}) => (
    <div 
        className={cn(
            "flex items-center justify-between p-2 rounded-md cursor-pointer group/menu-item", 
            selected ? 'bg-primary/10' : 'hover:bg-primary/5'
        )}
        onClick={onSelect}
    >
        <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0 h-10 w-10 rounded-md overflow-hidden bg-muted border">
                {item.thumbnailUrl ? (
                    <Image 
                        key={item.thumbnailUrl}
                        src={item.thumbnailUrl}
                        alt={item.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full w-full">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                )}
            </div>
            <span className={cn("font-medium truncate", selected && "text-primary")}>{item.name}</span>
        </div>
        <div className="flex items-center opacity-0 group-hover/menu-item:opacity-100 transition-opacity">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEditThumbnail}><ImageIcon className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
    </div>
);


const Column = ({ title, children, onAdd }: {
    title: string;
    children: React.ReactNode;
    onAdd: (() => void) | null;
}) => (
    <div className="flex-1 min-w-[300px] bg-muted/50 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">{title}</h3>
            {onAdd && <Button size="sm" onClick={onAdd}><Plus className="mr-2 h-4 w-4"/>추가</Button>}
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto h-[60vh] p-1">
            {children}
        </div>
    </div>
);


type NameDialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};
type ThumbnailDialogState = {
    isOpen: boolean;
    item: Field | Classification | Course | null;
    type: 'fields' | 'classifications' | 'courses';
}
type DeleteAlertState = {
    isOpen: boolean;
    item: Item | null;
    collectionName: 'fields' | 'classifications' | 'courses' | null;
};

export default function HierarchyManager() {
  const firestore = useFirestore();
  const { toast, dismiss } = useToast();
  const [isPending, startTransition] = useTransition();

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

  const [nameDialog, setNameDialog] = useState<NameDialogState>({ isOpen: false, item: null, type: '분야' });
  const [thumbnailDialog, setThumbnailDialog] = useState<ThumbnailDialogState>({ isOpen: false, item: null, type: 'fields' });
  const [deleteAlert, setDeleteAlert] = useState<DeleteAlertState>({ isOpen: false, item: null, collectionName: null });


  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() =>
    firestore && selectedField ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedField)) : null,
    [firestore, selectedField]
  );
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() =>
    firestore && selectedClassification ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassification)) : null,
    [firestore, selectedClassification]
  );
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);
  
  useEffect(() => {
    if (selectedField && fields && !fields.find(f => f.id === selectedField)) {
      setSelectedField(null);
    }
  }, [fields, selectedField]);

  useEffect(() => {
    if (selectedClassification && classifications && !classifications.find(c => c.id === selectedClassification)) {
      setSelectedClassification(null);
    }
  }, [classifications, selectedClassification]);

  const handleSelectField = (id: string | null) => {
    setSelectedField(id);
    setSelectedClassification(null);
  };

  const handleSelectClassification = (id: string | null) => {
    setSelectedClassification(id);
  };

  const openNameDialog = (type: NameDialogState['type'], item: HierarchyItem | null = null) => {
    if ((type === '큰분류' && !selectedField) || (type === '상세분류' && !selectedClassification)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setNameDialog({ isOpen: true, item, type });
  };
  
  const openThumbnailDialog = (type: ThumbnailDialogState['type'], item: Field | Classification | Course) => {
    setThumbnailDialog({ isOpen: true, item, type });
  }

  const closeDialogs = () => {
      setNameDialog({ isOpen: false, item: null, type: '분야' });
      setThumbnailDialog({ isOpen: false, item: null, type: 'fields' });
  };
  
  const closeDeleteAlert = () => {
    setDeleteAlert({ isOpen: false, item: null, collectionName: null });
  }

  const handleSaveName = async (itemData: HierarchyItem) => {
    if (!firestore) return;
    try {
        const { type, item: existingItem } = nameDialog;
        const collectionName = type === '분야' ? 'fields' : type === '큰분류' ? 'classifications' : 'courses';

        if (existingItem?.id) { // Edit mode
            await updateDoc(doc(firestore, collectionName, existingItem.id), { name: itemData.name });
            toast({ title: '수정 성공', description: `'${itemData.name}'으로 이름이 수정되었습니다.` });
        } else { // Add mode
             const docRef = doc(firestore, collectionName, uuidv4());
            if (type === '분야') {
                await setDoc(docRef, { name: itemData.name, thumbnailUrl: '' });
            } else if (type === '큰분류' && selectedField) {
                await setDoc(docRef, {
                    fieldId: selectedField,
                    name: itemData.name,
                    description: `${itemData.name}에 대한 설명입니다.`,
                    prices: { day1: 0, day30: 10000, day60: 18000, day90: 25000 },
                    thumbnailUrl: '',
                });
            } else if (type === '상세분류' && selectedClassification) {
                await setDoc(docRef, {
                    classificationId: selectedClassification,
                    name: itemData.name,
                    description: `${itemData.name}에 대한 상세 설명입니다.`,
                    thumbnailUrl: '',
                });
            }
            toast({ title: '추가 성공', description: `${type} '${itemData.name}'이(가) 추가되었습니다.` });
        }
    } catch (error: any) {
        console.error("Error saving document: ", error);
        toast({ variant: 'destructive', title: '저장 실패', description: error.message || '항목 저장 중 오류가 발생했습니다.' });
    } finally {
        closeDialogs();
    }
  };
  
  const handleDeleteRequest = (e: React.MouseEvent, collectionName: 'fields' | 'classifications' | 'courses', item: Item) => {
    e.stopPropagation();
    setDeleteAlert({ isOpen: true, item, collectionName });
  };

  const executeDelete = useCallback(() => {
    const { item, collectionName } = deleteAlert;
    if (!item || !collectionName) return;

    startTransition(async () => {
        const { id: toastId } = toast({
            title: '삭제 중...',
            description: `'${item.name}' 항목을 삭제하고 있습니다.`,
            duration: 999999,
        });

        try {
            const result = await deleteHierarchyItem(collectionName, item.id, sanitize(item));
            
            dismiss(toastId);

            if (result.success) {
                toast({ title: '삭제 성공', description: result.message, duration: 5000 });
                if (collectionName === 'fields' && selectedField === item.id) {
                    setSelectedField(null);
                }
                if (collectionName === 'classifications' && selectedClassification === item.id) {
                    setSelectedClassification(null);
                }
            } else {
                 toast({
                    variant: "destructive",
                    title: "하위 비디오(에피소드)가 존재하여 삭제할 수 없습니다.",
                    description: (
                        <div className="mt-2 w-full rounded-md bg-slate-950 p-4">
                           <p className="text-white">아래 비디오를 먼저 삭제해야 합니다:</p>
                           <ul className="list-disc pl-5 mt-2 text-sm text-white/80">
                                {result.dependencies?.map((dep, i) => <li key={i}>{dep}</li>)}
                           </ul>
                        </div>
                    ),
                    duration: 15000,
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            dismiss(toastId);
            toast({
                variant: "destructive",
                title: "삭제 중 오류 발생",
                description: errorMessage,
                duration: 9000,
            });
        } finally {
            closeDeleteAlert();
        }
    });
  }, [toast, dismiss, startTransition, selectedField, selectedClassification, deleteAlert]);


  const renderSkeletons = () => (
    <div className="flex flex-col gap-2">
        {Array.from({length: 5}).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-md">
                <Skeleton className="h-10 w-10 rounded-md" />
                <Skeleton className="h-5 flex-grow" />
            </div>
        ))}
    </div>
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>콘텐츠 계층 관리</CardTitle>
          <p className="text-sm text-muted-foreground">분야 &gt; 큰분류 &gt; 상세분류 순서로 콘텐츠 계층을 관리합니다. 항목을 클릭하여 하위 항목을 확인하세요.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <Column title="분야 (Field)" onAdd={() => openNameDialog('분야')}>
                {fieldsLoading || isPending ? renderSkeletons() : fields?.map(item => (
                    <ItemRow
                        key={item.id}
                        item={{ ...item, type: 'field' }}
                        selected={selectedField === item.id}
                        onSelect={() => handleSelectField(item.id)}
                        onEdit={(e) => { e.stopPropagation(); openNameDialog('분야', item); }}
                        onEditThumbnail={(e) => { e.stopPropagation(); openThumbnailDialog('fields', item); }}
                        onDelete={(e) => handleDeleteRequest(e, 'fields', {...item, type: 'field'})}
                    />
                ))}
            </Column>
            <Column title="큰분류 (Classification)" onAdd={selectedField ? () => openNameDialog('큰분류') : null}>
                {!selectedField ? <p className="text-center text-sm text-muted-foreground pt-4">분야를 선택해주세요.</p> :
                 classificationsLoading || isPending ? renderSkeletons() :
                 classifications?.map(item => (
                     <ItemRow 
                        key={item.id}
                        item={{...item, type: 'classification'}}
                        selected={selectedClassification === item.id}
                        onSelect={() => handleSelectClassification(item.id)}
                        onEdit={(e) => { e.stopPropagation(); openNameDialog('큰분류', item); }}
                        onDelete={(e) => handleDeleteRequest(e, 'classifications', {...item, type: 'classification'})}
                        onEditThumbnail={(e) => { e.stopPropagation(); openThumbnailDialog('classifications', item); }}
                     />
                 ))
                }
            </Column>
            <Column title="상세분류 (Course)" onAdd={selectedClassification ? () => openNameDialog('상세분류') : null}>
                {!selectedClassification ? <p className="text-center text-sm text-muted-foreground pt-4">큰분류를 선택해주세요.</p> :
                 coursesLoading || isPending ? renderSkeletons() :
                 courses?.map(item => (
                    <ItemRow 
                       key={item.id}
                       item={{...item, type: 'course'}}
                       selected={false} // No selection action for the last column
                       onSelect={() => {}}
                       onEdit={(e) => { e.stopPropagation(); openNameDialog('상세분류', item); }}
                       onDelete={(e) => handleDeleteRequest(e, 'courses', {...item, type: 'course'})}
                       onEditThumbnail={(e) => { e.stopPropagation(); openThumbnailDialog('courses', item); }}
                    />
                ))
                }
            </Column>
          </div>
        </CardContent>
      </Card>
      
      {nameDialog.isOpen && (
        <HierarchyItemDialog
          isOpen={nameDialog.isOpen}
          onClose={closeDialogs}
          onSave={handleSaveName}
          item={nameDialog.item}
          itemType={nameDialog.type}
        />
      )}

      {thumbnailDialog.isOpen && thumbnailDialog.item && (
        <ThumbnailEditorDialog
            key={thumbnailDialog.item.id} // Add key to force re-mount
            isOpen={thumbnailDialog.isOpen}
            onClose={closeDialogs}
            item={thumbnailDialog.item}
            itemType={thumbnailDialog.type}
        />
      )}

      <AlertDialog open={deleteAlert.isOpen} onOpenChange={(open) => !open && closeDeleteAlert()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{deleteAlert.item?.name}&apos; 항목은 하위 항목이 없을 경우에만 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteAlert}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
